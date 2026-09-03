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

// The database is the only source of truth for leads.
const PROJECT_DIR = fs.existsSync(path.join(process.cwd(), 'backend'))
  ? process.cwd()
  : path.resolve(process.cwd(), '..');
const BACKEND_DIR = path.join(PROJECT_DIR, 'backend');
const prisma = new PrismaClient();
const databaseAvailable = Boolean(process.env.DATABASE_URL);
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

async function loadLeads(): Promise<LeadRecord[]> {
  if (!databaseAvailable) {
    throw new Error('DATABASE_URL não configurada. O banco de dados é obrigatório.');
  }

  const dbLeads = await prisma.atendimento.findMany({ orderBy: { createdAt: 'desc' } });
  return dbLeads.map((lead) => ({
          id: lead.id,
          codigoFormatado: lead.codigoFormatado,
          nome: lead.nome,
          telefone: lead.telefone,
          tipoFormula: lead.tipoFormula,
          possuiReceita: lead.possuiReceita,
          localizacao: lead.localizacao,
          objetivo: lead.objetivo ?? undefined,
          conhecimentoFormula: lead.conhecimentoFormula ?? undefined,
          status: lead.status as LeadRecord['status'],
          origem: lead.origem,
          ip: lead.ip ?? undefined,
          userAgent: lead.userAgent ?? undefined,
          whatsappClickedAt: lead.whatsappClickedAt?.toISOString() ?? null,
          recuperadoAt: lead.recuperadoAt?.toISOString() ?? null,
          convertidoAt: lead.convertidoAt?.toISOString() ?? null,
          valorConversao: lead.valorConversao ?? null,
          observacoes: lead.observacoes ?? null,
          createdAt: lead.createdAt.toISOString(),
          updatedAt: lead.updatedAt.toISOString(),
  }));
}

async function getNextCodeFormatted(): Promise<string> {
  const leads = await loadLeads();
  let max = 1084;
  for (const l of leads) {
    if (l.codigoFormatado) {
      const match = l.codigoFormatado.match(/#FP-(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > max) max = num;
      }
    }
  }
  return `#FP-${max + 1}`;
}

async function createLeadRecord(leadData: Omit<LeadRecord, 'id' | 'codigoFormatado' | 'createdAt' | 'updatedAt'>): Promise<LeadRecord> {
  const codigoFormatado = await getNextCodeFormatted();
  const id = `clq_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const nowStr = new Date().toISOString();

  const newLead: LeadRecord = {
    ...leadData,
    id,
    codigoFormatado,
    createdAt: nowStr,
    updatedAt: nowStr,
  };

  if (!databaseAvailable) {
    throw new Error('DATABASE_URL não configurada. O banco de dados é obrigatório.');
  }

  await prisma.atendimento.create({
        data: {
          id: newLead.id,
          codigoFormatado: newLead.codigoFormatado,
          nome: newLead.nome,
          telefone: newLead.telefone,
          tipoFormula: newLead.tipoFormula,
          possuiReceita: newLead.possuiReceita,
          localizacao: newLead.localizacao,
          objetivo: newLead.objetivo,
          conhecimentoFormula: newLead.conhecimentoFormula,
          status: newLead.status as any,
          origem: newLead.origem,
          ip: newLead.ip,
          userAgent: newLead.userAgent,
          whatsappClickedAt: newLead.whatsappClickedAt ? new Date(newLead.whatsappClickedAt) : null,
          recuperadoAt: newLead.recuperadoAt ? new Date(newLead.recuperadoAt) : null,
          convertidoAt: newLead.convertidoAt ? new Date(newLead.convertidoAt) : null,
          valorConversao: newLead.valorConversao,
          observacoes: newLead.observacoes,
          createdAt: new Date(newLead.createdAt),
          updatedAt: new Date(newLead.updatedAt),
        },
  });
  console.log(`[Supabase Lead Criado] ${newLead.codigoFormatado} - ${newLead.nome}`);
  return newLead;
}

async function updateLeadRecord(idOrCode: string, updates: Partial<LeadRecord>): Promise<LeadRecord | null> {
  const now = new Date();
  const nowStr = now.toISOString();

  if (!databaseAvailable) {
    throw new Error('DATABASE_URL não configurada. O banco de dados é obrigatório.');
  }

  const dataToUpdate: any = { updatedAt: now };
  if (updates.status) dataToUpdate.status = updates.status;
  if (updates.whatsappClickedAt !== undefined) {
    dataToUpdate.whatsappClickedAt = updates.whatsappClickedAt ? new Date(updates.whatsappClickedAt) : null;
  }
  if (updates.recuperadoAt !== undefined) {
    dataToUpdate.recuperadoAt = updates.recuperadoAt ? new Date(updates.recuperadoAt) : null;
  }
  if (updates.convertidoAt !== undefined) {
    dataToUpdate.convertidoAt = updates.convertidoAt ? new Date(updates.convertidoAt) : null;
  }
  if (updates.valorConversao !== undefined) dataToUpdate.valorConversao = updates.valorConversao;
  if (updates.observacoes !== undefined) dataToUpdate.observacoes = updates.observacoes;

  const result = await prisma.atendimento.updateMany({
    where: {
      OR: [{ id: idOrCode }, { codigoFormatado: idOrCode }],
    },
    data: dataToUpdate,
  });

  if (result.count === 0) return null;
  const updated = await prisma.atendimento.findFirst({
    where: { OR: [{ id: idOrCode }, { codigoFormatado: idOrCode }] },
  });
  if (!updated) return null;
  return (await loadLeads()).find((lead) => lead.id === updated.id) || null;
}

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

      const newLead = await createLeadRecord({
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
        convertidoAt: null,
        valorConversao: null,
        observacoes: null,
      });

      console.log(`[Lead Criado] ${newLead.codigoFormatado} - ${newLead.nome} (Status: ${newLead.status})`);

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
  app.patch('/api/leads/:id/whatsapp-click', async (req, res) => {
    try {
      const { id } = req.params;
      const now = new Date().toISOString();
      const updated = await updateLeadRecord(id, {
        status: 'WHATSAPP_INICIADO',
        whatsappClickedAt: now,
      });

      if (!updated) {
        return res.status(404).json({ error: 'Atendimento não encontrado.' });
      }

      console.log(`[WhatsApp Iniciado] ${updated.codigoFormatado} - ${updated.nome}`);

      res.json({
        success: true,
        lead: updated,
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

  // 5. Atualizar Status Geral do Atendimento
  app.patch('/api/leads/:id/status', async (req, res) => {
    try {
      const { id } = req.params;
      const { status, observacoes, valorConversao } = req.body;

      if (!status) {
        return res.status(400).json({ error: 'Status é obrigatório.' });
      }

      const updates: Partial<LeadRecord> = { status };
      const now = new Date().toISOString();

      if (status === 'CONVERTIDO') {
        updates.convertidoAt = now;
        if (valorConversao) updates.valorConversao = Number(valorConversao);
      } else if (status === 'RECUPERADO_ATENDIMENTO') {
        updates.recuperadoAt = now;
      } else if (status === 'WHATSAPP_INICIADO') {
        updates.whatsappClickedAt = now;
      }

      if (observacoes !== undefined) {
        updates.observacoes = String(observacoes);
      }

      const updated = await updateLeadRecord(id, updates);
      if (!updated) {
        return res.status(404).json({ error: 'Atendimento não encontrado.' });
      }

      console.log(`[Status Atualizado] ${updated.codigoFormatado} -> ${status}`);

      res.json({
        success: true,
        lead: updated,
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
      const now = new Date().toISOString();

      const updates: Partial<LeadRecord> = {
        status: 'CONVERTIDO',
        convertidoAt: now,
      };
      if (valorConversao) updates.valorConversao = Number(valorConversao);
      if (observacoes) updates.observacoes = String(observacoes);

      const updated = await updateLeadRecord(id, updates);
      if (!updated) {
        return res.status(404).json({ error: 'Atendimento não encontrado.' });
      }

      console.log(`[Venda/Fórmula CONVERTIDA!] ${updated.codigoFormatado} - ${updated.nome}`);

      res.json({
        success: true,
        lead: updated,
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
      const now = new Date().toISOString();

      const updates: Partial<LeadRecord> = {
        status: 'RECUPERADO_ATENDIMENTO',
        recuperadoAt: now,
      };
      if (observacoes) updates.observacoes = String(observacoes);

      const updated = await updateLeadRecord(id, updates);
      if (!updated) {
        return res.status(404).json({ error: 'Atendimento não encontrado.' });
      }

      res.json({
        success: true,
        lead: updated,
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

  // 9. Seed Demo Leads (Desativado)
  app.post('/api/leads/seed-demo', async (req, res) => {
    return res.status(404).json({ error: 'Rota desativada.' });
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
    console.error(
      'Banco de dados indisponível; as rotas de leads permanecerão indisponíveis. Verifique DATABASE_URL e DIRECT_URL.',
      err instanceof Error ? err.message.split('\n')[0] : err,
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
