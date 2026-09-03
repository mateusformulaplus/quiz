import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import { PrismaClient } from '@prisma/client';

interface LeadRecord {
  id: string;
  codigoFormatado: string;
  nome: string;
  telefone: string;
  tipoFormula: string;
  possuiReceita: string;
  localizacao: string;
  objetivo?: string;
  conhecimentoFormula?: string;
  status: 'AVALIACAO_INICIADA' | 'AVALIACAO_CONCLUIDA' | 'QUALIFICADO_AGUARDANDO_WHATSAPP' | 'WHATSAPP_INICIADO' | 'CONVERTIDO' | 'RECUPERADO_ATENDIMENTO' | 'DESQUALIFICADO';
  origem: string;
  ip?: string;
  userAgent?: string;
  whatsappClickedAt?: string | null;
  recuperadoAt?: string | null;
  convertidoAt?: string | null;
  valorConversao?: number | null;
  observacoes?: string | null;
  createdAt: string;
  updatedAt: string;
}

const ATENDIMENTO_EMAIL = process.env.ATENDIMENTO_EMAIL?.trim().toLowerCase() || 'formulaplusrj@gmail.com';
const ATENDIMENTO_PASSWORD = process.env.ATENDIMENTO_PASSWORD || 'Formulaplus@2026';

// In-memory + file store persistence for demo/dev reliability
const PROJECT_DIR = fs.existsSync(path.join(process.cwd(), 'backend'))
  ? process.cwd()
  : path.resolve(process.cwd(), '..');
const BACKEND_DIR = path.join(PROJECT_DIR, 'backend');
const DATA_DIR = path.join(BACKEND_DIR, 'data');
const DATA_FILE = path.join(DATA_DIR, 'leads.json');
const prisma = new PrismaClient();
let databaseAvailable = Boolean(process.env.DATABASE_URL);
const activeTokens = new Map<string, number>();
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function hashPassword(password: string) {
  return scryptSync(password, 'formula-plus-dashboard', 64).toString('hex');
}

function passwordMatches(password: string, hash: string) {
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, 'formula-plus-dashboard', 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function ensureDashboardUser() {
  if (!databaseAvailable) return;
  if (!ATENDIMENTO_EMAIL || !ATENDIMENTO_PASSWORD) {
    throw new Error('ATENDIMENTO_EMAIL e ATENDIMENTO_PASSWORD são obrigatórios.');
  }
  

  const existingUser = await prisma.dashboardUser.findUnique({ where: { email: ATENDIMENTO_EMAIL } });
  if (!existingUser) {
    await prisma.dashboardUser.create({
      data: { email: ATENDIMENTO_EMAIL, passwordHash: hashPassword(ATENDIMENTO_PASSWORD), name: 'formulaplus' },
    });
  } else if (existingUser.name !== 'formulaplus') {
    await prisma.dashboardUser.update({
      where: { email: ATENDIMENTO_EMAIL },
      data: { name: 'formulaplus' },
    });
  }
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
}

function loadLeadsFromFile(): LeadRecord[] {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as LeadRecord[];
}

function saveLeadsToFile(leads: LeadRecord[]) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(leads, null, 2), 'utf-8');
}

async function loadLeads(): Promise<LeadRecord[]> {
  if (databaseAvailable) {
    try {
      const leads = await prisma.atendimento.findMany({ orderBy: { createdAt: 'desc' } });
      return leads.map((lead) => ({
        ...lead,
        status: lead.status as LeadRecord['status'],
        createdAt: lead.createdAt.toISOString(),
        updatedAt: lead.updatedAt.toISOString(),
        whatsappClickedAt: lead.whatsappClickedAt?.toISOString() ?? null,
        recuperadoAt: lead.recuperadoAt?.toISOString() ?? null,
        convertidoAt: lead.convertidoAt?.toISOString() ?? null,
      }));
    } catch (err) {
      databaseAvailable = false;
      console.error('Supabase indisponível; usando armazenamento local:', err);
    }
  }

  return loadLeadsFromFile();
}

async function saveLeads(leads: LeadRecord[]) {
  if (databaseAvailable) {
    try {
      await prisma.$transaction([
        prisma.atendimento.deleteMany(),
        prisma.atendimento.createMany({
          data: leads.map((lead) => ({
            id: lead.id,
            codigoFormatado: lead.codigoFormatado,
            nome: lead.nome,
            telefone: lead.telefone,
            tipoFormula: lead.tipoFormula,
            possuiReceita: lead.possuiReceita,
            localizacao: lead.localizacao,
            objetivo: lead.objetivo,
            conhecimentoFormula: lead.conhecimentoFormula,
            status: lead.status as any,
            origem: lead.origem,
            ip: lead.ip,
            userAgent: lead.userAgent,
            whatsappClickedAt: lead.whatsappClickedAt ? new Date(lead.whatsappClickedAt) : null,
            recuperadoAt: lead.recuperadoAt ? new Date(lead.recuperadoAt) : null,
            convertidoAt: lead.convertidoAt ? new Date(lead.convertidoAt) : null,
            valorConversao: lead.valorConversao,
            observacoes: lead.observacoes,
            createdAt: new Date(lead.createdAt),
            updatedAt: new Date(lead.updatedAt),
          })),
        }),
      ]);
      return;
    } catch (err) {
      databaseAvailable = false;
      console.error('Falha ao gravar no Supabase; usando armazenamento local:', err);
    }
  }

  saveLeadsToFile(leads);
}

let codeCounter = 1085;

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const PORT = Number(process.env.PORT) || 3000;
  const frontendUrl = process.env.FRONTEND_URL?.replace(/\/$/, '');

  app.use((req, res, next) => {
    const requestOrigin = req.headers.origin;
    if (requestOrigin) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS, PUT, DELETE');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json());

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      storage: databaseAvailable ? 'supabase' : 'local-dev',
      timestamp: new Date().toISOString(),
    });
  });

  // Auth Route for Atendimento Team
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
      }

      const cleanEmail = String(email).trim().toLowerCase();
      const cleanPassword = String(password).trim();

      // Check fallback credentials
      if (cleanEmail === ATENDIMENTO_EMAIL && cleanPassword === ATENDIMENTO_PASSWORD) {
        const token = randomUUID();
        activeTokens.set(token, Date.now() + TOKEN_TTL_MS);
        return res.json({
          success: true,
          token,
          user: {
            email: ATENDIMENTO_EMAIL,
            name: 'formulaplus',
            role: 'atendente_farmacia',
          },
        });
      }

      if (databaseAvailable) {
        const user = await prisma.dashboardUser.findUnique({ where: { email: cleanEmail } });
        if (user && passwordMatches(cleanPassword, user.passwordHash)) {
          const token = randomUUID();
          activeTokens.set(token, Date.now() + TOKEN_TTL_MS);
          return res.json({
            success: true,
            token,
            user: {
              email: user.email,
              name: user.name,
              role: user.role,
            },
          });
        }
      }

      return res.status(401).json({
        error: 'Credenciais inválidas. Verifique seu e-mail e senha de acesso.',
      });
    } catch (err: any) {
      console.error('Erro na autenticação:', err);
      res.status(500).json({ error: 'Erro interno ao autenticar.' });
    }
  });

  const requireAuth: express.RequestHandler = (req, res, next) => {
    const authorization = req.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const expiresAt = token ? activeTokens.get(token) : undefined;

    if (!expiresAt || expiresAt <= Date.now()) {
      if (token) activeTokens.delete(token);
      return res.status(401).json({ error: 'Autenticação necessária.' });
    }

    next();
  };

  app.use('/api/leads/recovery', requireAuth);
  app.use('/api/leads/:id/status', requireAuth);
  app.use('/api/leads/:id/convert', requireAuth);
  app.use('/api/leads/:id/contacted', requireAuth);
  app.use('/api/dashboard', requireAuth);


  // 1. Criar novo Atendimento / Lead (Status Inicial: QUALIFICADO_AGUARDANDO_WHATSAPP)
  app.post('/api/leads', async (req, res) => {
    try {
      const {
        nome,
        telefone,
        tipoFormula,
        possuiReceita,
        localizacao,
        objetivo,
        conhecimentoFormula,
        origem = 'landing_page_quiz',
      } = req.body;

      if (!nome || !telefone) {
        return res.status(400).json({ error: 'Nome e telefone são obrigatórios.' });
      }

      const leads = await loadLeads();
      const nextCodeNumber = codeCounter++;
      const codigoFormatado = `#FP-${nextCodeNumber}`;
      const id = `clq_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      const newLead: LeadRecord = {
        id,
        codigoFormatado,
        nome: String(nome).trim(),
        telefone: String(telefone).trim(),
        tipoFormula: String(tipoFormula || 'Fórmula manipulada'),
        possuiReceita: String(possuiReceita || 'A verificar'),
        localizacao: String(localizacao || 'RJ'),
        objetivo: objetivo ? String(objetivo) : undefined,
        conhecimentoFormula: conhecimentoFormula ? String(conhecimentoFormula) : undefined,
        status: 'QUALIFICADO_AGUARDANDO_WHATSAPP',
        origem: String(origem),
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        whatsappClickedAt: null,
        recuperadoAt: null,
        observacoes: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      leads.unshift(newLead);
      await saveLeads(leads);

      console.log(`[Lead Criado] ${codigoFormatado} - ${newLead.nome} (Status: ${newLead.status})`);

      res.status(201).json({
        success: true,
        lead: newLead,
      });
    } catch (err: any) {
      console.error('Erro ao criar lead:', err);
      res.status(500).json({ error: 'Erro interno ao salvar lead.' });
    }
  });

  // 2. Registrar Clique no WhatsApp (Altera status para WHATSAPP_INICIADO)
  // Regra fundamental: este lead deixará de aparecer na fila de recuperação do dashboard
  app.patch('/api/leads/:id/whatsapp-click', async (req, res) => {
    try {
      const { id } = req.params;
      const leads = await loadLeads();
      const index = leads.findIndex((l) => l.id === id || l.codigoFormatado === id);

      if (index === -1) {
        return res.status(404).json({ error: 'Atendimento não encontrado.' });
      }

      const now = new Date().toISOString();
      leads[index].status = 'WHATSAPP_INICIADO';
      leads[index].whatsappClickedAt = now;
      leads[index].updatedAt = now;

      await saveLeads(leads);

      console.log(`[WhatsApp Iniciado] ${leads[index].codigoFormatado} - ${leads[index].nome} -> Removido da fila de recuperação`);

      res.json({
        success: true,
        lead: leads[index],
      });
    } catch (err: any) {
      console.error('Erro ao atualizar status do WhatsApp:', err);
      res.status(500).json({ error: 'Erro ao atualizar status.' });
    }
  });

  // 3. Fila de Recuperação (APENAS leads com status QUALIFICADO_AGUARDANDO_WHATSAPP)
  app.get('/api/leads/recovery', async (req, res) => {
    try {
      const { q } = req.query;
      const leads = await loadLeads();

      // FILTRO CRUCIAL: Apenas quem foi qualificado e NÃO clicou no WhatsApp
      let recoveryLeads = leads.filter(
        (l) => l.status === 'QUALIFICADO_AGUARDANDO_WHATSAPP'
      );

      if (q && typeof q === 'string') {
        const query = q.toLowerCase();
        recoveryLeads = recoveryLeads.filter(
          (l) =>
            l.nome.toLowerCase().includes(query) ||
            l.telefone.includes(query) ||
            l.localizacao.toLowerCase().includes(query) ||
            l.tipoFormula.toLowerCase().includes(query) ||
            l.codigoFormatado.toLowerCase().includes(query)
        );
      }

      // Ordenar do mais recente para o mais antigo
      recoveryLeads.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      res.json({
        success: true,
        count: recoveryLeads.length,
        leads: recoveryLeads,
      });
    } catch (err: any) {
      console.error('Erro ao buscar leads de recuperação:', err);
      res.status(500).json({ error: 'Erro ao listar leads.' });
    }
  });

  // 4. Todos os Leads (Histórico Geral e Auditoria)
  app.get('/api/leads', requireAuth, async (req, res) => {
    try {
      const { status, q } = req.query;
      let leads = await loadLeads();

      if (status && typeof status === 'string' && status !== 'ALL') {
        leads = leads.filter((l) => l.status === status);
      }

      if (q && typeof q === 'string') {
        const query = q.toLowerCase();
        leads = leads.filter(
          (l) =>
            l.nome.toLowerCase().includes(query) ||
            l.telefone.includes(query) ||
            l.localizacao.toLowerCase().includes(query) ||
            l.tipoFormula.toLowerCase().includes(query) ||
            l.codigoFormatado.toLowerCase().includes(query)
        );
      }

      leads.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      res.json({
        success: true,
        count: leads.length,
        leads,
      });
    } catch (err: any) {
      console.error('Erro ao buscar todos os leads:', err);
      res.status(500).json({ error: 'Erro ao listar histórico.' });
    }
  });

  // 5. Atualizar Status Geral do Atendimento (ex: CONVERTIDO, WHATSAPP_INICIADO, RECUPERADO_ATENDIMENTO)
  app.patch('/api/leads/:id/status', async (req, res) => {
    try {
      const { id } = req.params;
      const { status, observacoes, valorConversao } = req.body;

      if (!status) {
        return res.status(400).json({ error: 'Status é obrigatório.' });
      }

      const leads = await loadLeads();
      const index = leads.findIndex((l) => l.id === id || l.codigoFormatado === id);

      if (index === -1) {
        return res.status(404).json({ error: 'Atendimento não encontrado.' });
      }

      const now = new Date().toISOString();
      leads[index].status = status;
      leads[index].updatedAt = now;

      if (status === 'CONVERTIDO') {
        leads[index].convertidoAt = now;
        if (valorConversao) {
          leads[index].valorConversao = Number(valorConversao);
        }
      } else if (status === 'RECUPERADO_ATENDIMENTO') {
        leads[index].recuperadoAt = now;
      } else if (status === 'WHATSAPP_INICIADO') {
        leads[index].whatsappClickedAt = leads[index].whatsappClickedAt || now;
      }

      if (observacoes !== undefined) {
        leads[index].observacoes = String(observacoes);
      }

      await saveLeads(leads);

      console.log(`[Status Atualizado] ${leads[index].codigoFormatado} -> ${status}`);

      res.json({
        success: true,
        lead: leads[index],
      });
    } catch (err: any) {
      console.error('Erro ao atualizar status do lead:', err);
      res.status(500).json({ error: 'Erro ao atualizar status.' });
    }
  });

  // 6. Marcar Atendimento como CONVERTIDO (Venda/Manipulação Concretizada)
  app.patch('/api/leads/:id/convert', async (req, res) => {
    try {
      const { id } = req.params;
      const { valorConversao, observacoes } = req.body;
      const leads = await loadLeads();
      const index = leads.findIndex((l) => l.id === id || l.codigoFormatado === id);

      if (index === -1) {
        return res.status(404).json({ error: 'Atendimento não encontrado.' });
      }

      const now = new Date().toISOString();
      leads[index].status = 'CONVERTIDO';
      leads[index].convertidoAt = now;
      leads[index].updatedAt = now;
      if (valorConversao) {
        leads[index].valorConversao = Number(valorConversao);
      }
      if (observacoes) {
        leads[index].observacoes = String(observacoes);
      }

      await saveLeads(leads);

      console.log(`[Venda/Fórmula CONVERTIDA!] ${leads[index].codigoFormatado} - ${leads[index].nome}`);

      res.json({
        success: true,
        lead: leads[index],
      });
    } catch (err: any) {
      console.error('Erro ao converter lead:', err);
      res.status(500).json({ error: 'Erro ao registrar conversão.' });
    }
  });

  // 7. Marcar Atendimento como Contatado / Recuperado
  app.patch('/api/leads/:id/contacted', async (req, res) => {
    try {
      const { id } = req.params;
      const { observacoes } = req.body;
      const leads = await loadLeads();
      const index = leads.findIndex((l) => l.id === id || l.codigoFormatado === id);

      if (index === -1) {
        return res.status(404).json({ error: 'Atendimento não encontrado.' });
      }

      const now = new Date().toISOString();
      leads[index].status = 'RECUPERADO_ATENDIMENTO';
      leads[index].recuperadoAt = now;
      leads[index].updatedAt = now;
      if (observacoes) {
        leads[index].observacoes = String(observacoes);
      }

      await saveLeads(leads);

      res.json({
        success: true,
        lead: leads[index],
      });
    } catch (err: any) {
      console.error('Erro ao marcar como contatado:', err);
      res.status(500).json({ error: 'Erro ao atualizar.' });
    }
  });

  // 8. Métricas do Dashboard
  app.get('/api/dashboard/metrics', async (req, res) => {
    try {
      const leads = await loadLeads();
      const avaliacoesConcluidas = leads.length;
      const whatsappIniciado = leads.filter((l) => l.status === 'WHATSAPP_INICIADO').length;
      const aguardandoWhatsapp = leads.filter((l) => l.status === 'QUALIFICADO_AGUARDANDO_WHATSAPP').length;
      const convertidos = leads.filter((l) => l.status === 'CONVERTIDO').length;
      const recuperados = leads.filter((l) => l.status === 'RECUPERADO_ATENDIMENTO').length;

      // Total de contatos iniciados (WhatsApp direto + Convertidos + Recuperados)
      const totalContatadosOuIniciados = whatsappIniciado + convertidos + recuperados;

      // Taxa de conversão WhatsApp / Avaliação Concluída
      const taxaConversao =
        avaliacoesConcluidas > 0
          ? Math.round((totalContatadosOuIniciados / avaliacoesConcluidas) * 1000) / 10
          : 0;

      // Taxa de Venda Final (Convertidos / Atendimentos iniciados)
      const taxaVendaFinal =
        totalContatadosOuIniciados > 0
          ? Math.round((convertidos / totalContatadosOuIniciados) * 1000) / 10
          : 0;

      res.json({
        success: true,
        metrics: {
          avaliacoesIniciadas: avaliacoesConcluidas,
          avaliacoesConcluidas,
          usuariosQualificados: avaliacoesConcluidas,
          whatsappIniciado,
          aguardandoWhatsapp,
          convertidos,
          taxaConversao,
          taxaVendaFinal,
        },
      });
    } catch (err: any) {
      console.error('Erro ao calcular métricas:', err);
      res.status(500).json({ error: 'Erro ao obter métricas.' });
    }
  });

  // 9. Seed Demo Leads
  app.post('/api/leads/seed-demo', async (req, res) => {
    return res.status(404).json({ error: 'Rota desativada.' });

    try {
      const demoData: LeadRecord[] = [
        {
          id: 'clq_1084_fp',
          codigoFormatado: '#FP-1084',
          nome: 'Mariana Silveira',
          telefone: '21988223344',
          tipoFormula: 'Medicamento Manipulado',
          possuiReceita: 'Já possuo receita médica',
          localizacao: 'Niterói (Icaraí)',
          objetivo: 'Fórmula personalizada',
          conhecimentoFormula: 'Já tenho a fórmula prescrita',
          status: 'QUALIFICADO_AGUARDANDO_WHATSAPP',
          origem: 'landing_page_quiz',
          createdAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
          updatedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
          whatsappClickedAt: null,
          recuperadoAt: null,
          convertidoAt: null,
          valorConversao: null,
          observacoes: null,
        },
        {
          id: 'clq_1082_fp',
          codigoFormatado: '#FP-1082',
          nome: 'Carlos Eduardo Nogueira',
          telefone: '21971234567',
          tipoFormula: 'Suplementação / Vitaminas',
          possuiReceita: 'Ainda não possuo receita',
          localizacao: 'São Gonçalo (Centro)',
          objetivo: 'Suplementação para treino e imunidade',
          conhecimentoFormula: 'Gostaria de falar com o time',
          status: 'QUALIFICADO_AGUARDANDO_WHATSAPP',
          origem: 'landing_page_quiz',
          createdAt: new Date(Date.now() - 95 * 60 * 1000).toISOString(),
          updatedAt: new Date(Date.now() - 95 * 60 * 1000).toISOString(),
          whatsappClickedAt: null,
          recuperadoAt: null,
          convertidoAt: null,
          valorConversao: null,
          observacoes: null,
        },
        {
          id: 'clq_1080_fp',
          codigoFormatado: '#FP-1080',
          nome: 'Luciana Martins Pereira',
          telefone: '21998765432',
          tipoFormula: 'Dermocosméticos & Cuidado Facial',
          possuiReceita: 'Já possuo receita médica',
          localizacao: 'Niterói (Ingá)',
          objetivo: 'Cuidados anti-idade e clareador',
          conhecimentoFormula: 'Prescrição de dermatologista',
          status: 'CONVERTIDO', // Convertido em venda
          origem: 'landing_page_quiz',
          createdAt: new Date(Date.now() - 150 * 60 * 1000).toISOString(),
          updatedAt: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
          whatsappClickedAt: new Date(Date.now() - 148 * 60 * 1000).toISOString(),
          recuperadoAt: null,
          convertidoAt: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
          valorConversao: 184.50,
          observacoes: 'Orçamento aprovado. Entregue na filial Icaraí.',
        },
        {
          id: 'clq_1079_fp',
          codigoFormatado: '#FP-1079',
          nome: 'Beatriz Vasconcelos',
          telefone: '21995432198',
          tipoFormula: 'Dermocosméticos & Cuidado Facial',
          possuiReceita: 'Já possuo receita médica',
          localizacao: 'Niterói (Santa Rosa)',
          objetivo: 'Cuidados com a pele e manchas',
          conhecimentoFormula: 'Tenho indicação de dermatologista',
          status: 'QUALIFICADO_AGUARDANDO_WHATSAPP',
          origem: 'landing_page_quiz',
          createdAt: new Date(Date.now() - 180 * 60 * 1000).toISOString(),
          updatedAt: new Date(Date.now() - 180 * 60 * 1000).toISOString(),
          whatsappClickedAt: null,
          recuperadoAt: null,
          convertidoAt: null,
          valorConversao: null,
          observacoes: null,
        },
        {
          id: 'clq_1065_fp',
          codigoFormatado: '#FP-1065',
          nome: 'Rodrigo Fontes',
          telefone: '21981112233',
          tipoFormula: 'Medicamento Manipulado',
          possuiReceita: 'Já possuo receita médica',
          localizacao: 'Rio de Janeiro (Outra região)',
          objetivo: 'Fórmula personalizada',
          conhecimentoFormula: 'Já tenho a fórmula',
          status: 'WHATSAPP_INICIADO',
          origem: 'landing_page_quiz',
          createdAt: new Date(Date.now() - 240 * 60 * 1000).toISOString(),
          updatedAt: new Date(Date.now() - 239 * 60 * 1000).toISOString(),
          whatsappClickedAt: new Date(Date.now() - 239 * 60 * 1000).toISOString(),
          recuperadoAt: null,
          convertidoAt: null,
          valorConversao: null,
          observacoes: 'Em negociação de envio por motoboy',
        },
      ];

      await saveLeads(demoData);
      res.json({ success: true, count: demoData.length });
    } catch (err: any) {
      res.status(500).json({ error: 'Erro ao gerar dados demo.' });
    }
  });

  // Tenta iniciar na porta desejada; se EADDRINUSE, tenta a próxima
  const listen = (port: number) => {
    httpServer.listen(port, '0.0.0.0', () => {
      console.log(`🚀 Formula Plus Server running on http://localhost:${port}`);
      if (port !== PORT) {
        console.log(`ℹ️  Porta ${PORT} estava em uso — usando ${port} automaticamente.`);
      }
    });

    httpServer.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.warn(`⚠️  Porta ${port} ocupada — tentando porta ${port + 1}...`);
        listen(port + 1);
      } else {
        console.error(`Não foi possível iniciar o servidor na porta ${port}:`, error);
        process.exitCode = 1;
      }
    });
  };

  listen(PORT);

  // Do not delay the frontend while an unavailable database connection times out.
  void ensureDashboardUser().catch((err) => {
    databaseAvailable = false;
    console.error(
      'Banco de dados indisponível; usando armazenamento local. Verifique DATABASE_URL e DIRECT_URL.',
      err instanceof Error ? err.message.split('\n')[0] : err,
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
