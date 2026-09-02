var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_config = require("dotenv/config");
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_crypto = require("crypto");
var import_vite = require("vite");
var import_client = require("@prisma/client");
var ATENDIMENTO_EMAIL = process.env.ATENDIMENTO_EMAIL?.trim().toLowerCase() || "";
var ATENDIMENTO_PASSWORD = process.env.ATENDIMENTO_PASSWORD || "";
var PROJECT_DIR = import_fs.default.existsSync(import_path.default.join(process.cwd(), "backend")) ? process.cwd() : import_path.default.resolve(process.cwd(), "..");
var BACKEND_DIR = import_path.default.join(PROJECT_DIR, "backend");
var DATA_DIR = import_path.default.join(BACKEND_DIR, "data");
var DATA_FILE = import_path.default.join(DATA_DIR, "leads.json");
var FRONTEND_CANDIDATES = [
  import_path.default.join(PROJECT_DIR, "frontend"),
  import_path.default.join(PROJECT_DIR, "backend", "frontend")
];
var FRONTEND_DIR = FRONTEND_CANDIDATES.find((candidate) => import_fs.default.existsSync(import_path.default.join(candidate, "package.json"))) || FRONTEND_CANDIDATES[0];
var prisma = new import_client.PrismaClient();
var databaseAvailable = Boolean(process.env.DATABASE_URL);
var activeTokens = /* @__PURE__ */ new Map();
var TOKEN_TTL_MS = 8 * 60 * 60 * 1e3;
function hashPassword(password) {
  return (0, import_crypto.scryptSync)(password, "formula-plus-dashboard", 64).toString("hex");
}
function passwordMatches(password, hash) {
  const expected = Buffer.from(hash, "hex");
  const actual = (0, import_crypto.scryptSync)(password, "formula-plus-dashboard", 64);
  return expected.length === actual.length && (0, import_crypto.timingSafeEqual)(expected, actual);
}
async function ensureDashboardUser() {
  if (!databaseAvailable) return;
  if (!ATENDIMENTO_EMAIL || !ATENDIMENTO_PASSWORD) {
    throw new Error("ATENDIMENTO_EMAIL e ATENDIMENTO_PASSWORD s\xE3o obrigat\xF3rios.");
  }
  const existingUser = await prisma.dashboardUser.findUnique({ where: { email: ATENDIMENTO_EMAIL } });
  if (!existingUser) {
    await prisma.dashboardUser.create({
      data: { email: ATENDIMENTO_EMAIL, passwordHash: hashPassword(ATENDIMENTO_PASSWORD) }
    });
  }
}
function ensureDataFile() {
  if (!import_fs.default.existsSync(DATA_DIR)) {
    import_fs.default.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!import_fs.default.existsSync(DATA_FILE)) {
    import_fs.default.writeFileSync(DATA_FILE, JSON.stringify([], null, 2), "utf-8");
  }
}
function loadLeadsFromFile() {
  ensureDataFile();
  return JSON.parse(import_fs.default.readFileSync(DATA_FILE, "utf-8"));
}
function saveLeadsToFile(leads) {
  ensureDataFile();
  import_fs.default.writeFileSync(DATA_FILE, JSON.stringify(leads, null, 2), "utf-8");
}
async function loadLeads() {
  if (databaseAvailable) {
    try {
      const leads = await prisma.atendimento.findMany({ orderBy: { createdAt: "desc" } });
      return leads.map((lead) => ({
        ...lead,
        status: lead.status,
        createdAt: lead.createdAt.toISOString(),
        updatedAt: lead.updatedAt.toISOString(),
        whatsappClickedAt: lead.whatsappClickedAt?.toISOString() ?? null,
        recuperadoAt: lead.recuperadoAt?.toISOString() ?? null,
        convertidoAt: lead.convertidoAt?.toISOString() ?? null
      }));
    } catch (err) {
      databaseAvailable = false;
      console.error("Supabase indispon\xEDvel; usando armazenamento local:", err);
    }
  }
  return loadLeadsFromFile();
}
async function saveLeads(leads) {
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
            status: lead.status,
            origem: lead.origem,
            ip: lead.ip,
            userAgent: lead.userAgent,
            whatsappClickedAt: lead.whatsappClickedAt ? new Date(lead.whatsappClickedAt) : null,
            recuperadoAt: lead.recuperadoAt ? new Date(lead.recuperadoAt) : null,
            convertidoAt: lead.convertidoAt ? new Date(lead.convertidoAt) : null,
            valorConversao: lead.valorConversao,
            observacoes: lead.observacoes,
            createdAt: new Date(lead.createdAt),
            updatedAt: new Date(lead.updatedAt)
          }))
        })
      ]);
      return;
    } catch (err) {
      databaseAvailable = false;
      console.error("Falha ao gravar no Supabase; usando armazenamento local:", err);
    }
  }
  saveLeadsToFile(leads);
}
var codeCounter = 1085;
async function startServer() {
  const app = (0, import_express.default)();
  const PORT = Number(process.env.PORT) || 3e3;
  try {
    await ensureDashboardUser();
  } catch (err) {
    databaseAvailable = false;
    console.error(
      "Banco de dados indispon\xEDvel; usando armazenamento local. Verifique DATABASE_URL e DIRECT_URL.",
      err instanceof Error ? err.message.split("\n")[0] : err
    );
  }
  app.use(import_express.default.json());
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      storage: databaseAvailable ? "supabase" : "local-dev",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "E-mail e senha s\xE3o obrigat\xF3rios." });
      }
      const cleanEmail = String(email).trim().toLowerCase();
      const cleanPassword = String(password).trim();
      if (!databaseAvailable) {
        return res.status(503).json({ error: "Banco de dados n\xE3o configurado." });
      }
      const user = await prisma.dashboardUser.findUnique({ where: { email: cleanEmail } });
      if (user && passwordMatches(cleanPassword, user.passwordHash)) {
        const token = (0, import_crypto.randomUUID)();
        activeTokens.set(token, Date.now() + TOKEN_TTL_MS);
        return res.json({
          success: true,
          token,
          user: {
            email: user.email,
            name: user.name,
            role: user.role
          }
        });
      }
      return res.status(401).json({
        error: "Credenciais inv\xE1lidas. Verifique seu e-mail e senha de acesso."
      });
    } catch (err) {
      console.error("Erro na autentica\xE7\xE3o:", err);
      res.status(500).json({ error: "Erro interno ao autenticar." });
    }
  });
  const requireAuth = (req, res, next) => {
    const authorization = req.headers.authorization;
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    const expiresAt = token ? activeTokens.get(token) : void 0;
    if (!expiresAt || expiresAt <= Date.now()) {
      if (token) activeTokens.delete(token);
      return res.status(401).json({ error: "Autentica\xE7\xE3o necess\xE1ria." });
    }
    next();
  };
  app.use("/api/leads/recovery", requireAuth);
  app.use("/api/leads/:id/status", requireAuth);
  app.use("/api/leads/:id/convert", requireAuth);
  app.use("/api/leads/:id/contacted", requireAuth);
  app.use("/api/dashboard", requireAuth);
  app.post("/api/leads", async (req, res) => {
    try {
      const {
        nome,
        telefone,
        tipoFormula,
        possuiReceita,
        localizacao,
        objetivo,
        conhecimentoFormula,
        origem = "landing_page_quiz"
      } = req.body;
      if (!nome || !telefone) {
        return res.status(400).json({ error: "Nome e telefone s\xE3o obrigat\xF3rios." });
      }
      const leads = await loadLeads();
      const nextCodeNumber = codeCounter++;
      const codigoFormatado = `#FP-${nextCodeNumber}`;
      const id = `clq_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const newLead = {
        id,
        codigoFormatado,
        nome: String(nome).trim(),
        telefone: String(telefone).trim(),
        tipoFormula: String(tipoFormula || "F\xF3rmula manipulada"),
        possuiReceita: String(possuiReceita || "A verificar"),
        localizacao: String(localizacao || "RJ"),
        objetivo: objetivo ? String(objetivo) : void 0,
        conhecimentoFormula: conhecimentoFormula ? String(conhecimentoFormula) : void 0,
        status: "QUALIFICADO_AGUARDANDO_WHATSAPP",
        origem: String(origem),
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        whatsappClickedAt: null,
        recuperadoAt: null,
        observacoes: null,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      leads.unshift(newLead);
      await saveLeads(leads);
      console.log(`[Lead Criado] ${codigoFormatado} - ${newLead.nome} (Status: ${newLead.status})`);
      res.status(201).json({
        success: true,
        lead: newLead
      });
    } catch (err) {
      console.error("Erro ao criar lead:", err);
      res.status(500).json({ error: "Erro interno ao salvar lead." });
    }
  });
  app.patch("/api/leads/:id/whatsapp-click", async (req, res) => {
    try {
      const { id } = req.params;
      const leads = await loadLeads();
      const index = leads.findIndex((l) => l.id === id || l.codigoFormatado === id);
      if (index === -1) {
        return res.status(404).json({ error: "Atendimento n\xE3o encontrado." });
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      leads[index].status = "WHATSAPP_INICIADO";
      leads[index].whatsappClickedAt = now;
      leads[index].updatedAt = now;
      await saveLeads(leads);
      console.log(`[WhatsApp Iniciado] ${leads[index].codigoFormatado} - ${leads[index].nome} -> Removido da fila de recupera\xE7\xE3o`);
      res.json({
        success: true,
        lead: leads[index]
      });
    } catch (err) {
      console.error("Erro ao atualizar status do WhatsApp:", err);
      res.status(500).json({ error: "Erro ao atualizar status." });
    }
  });
  app.get("/api/leads/recovery", async (req, res) => {
    try {
      const { q } = req.query;
      const leads = await loadLeads();
      let recoveryLeads = leads.filter(
        (l) => l.status === "QUALIFICADO_AGUARDANDO_WHATSAPP"
      );
      if (q && typeof q === "string") {
        const query = q.toLowerCase();
        recoveryLeads = recoveryLeads.filter(
          (l) => l.nome.toLowerCase().includes(query) || l.telefone.includes(query) || l.localizacao.toLowerCase().includes(query) || l.tipoFormula.toLowerCase().includes(query) || l.codigoFormatado.toLowerCase().includes(query)
        );
      }
      recoveryLeads.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      res.json({
        success: true,
        count: recoveryLeads.length,
        leads: recoveryLeads
      });
    } catch (err) {
      console.error("Erro ao buscar leads de recupera\xE7\xE3o:", err);
      res.status(500).json({ error: "Erro ao listar leads." });
    }
  });
  app.get("/api/leads", requireAuth, async (req, res) => {
    try {
      const { status, q } = req.query;
      let leads = await loadLeads();
      if (status && typeof status === "string" && status !== "ALL") {
        leads = leads.filter((l) => l.status === status);
      }
      if (q && typeof q === "string") {
        const query = q.toLowerCase();
        leads = leads.filter(
          (l) => l.nome.toLowerCase().includes(query) || l.telefone.includes(query) || l.localizacao.toLowerCase().includes(query) || l.tipoFormula.toLowerCase().includes(query) || l.codigoFormatado.toLowerCase().includes(query)
        );
      }
      leads.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      res.json({
        success: true,
        count: leads.length,
        leads
      });
    } catch (err) {
      console.error("Erro ao buscar todos os leads:", err);
      res.status(500).json({ error: "Erro ao listar hist\xF3rico." });
    }
  });
  app.patch("/api/leads/:id/status", async (req, res) => {
    try {
      const { id } = req.params;
      const { status, observacoes, valorConversao } = req.body;
      if (!status) {
        return res.status(400).json({ error: "Status \xE9 obrigat\xF3rio." });
      }
      const leads = await loadLeads();
      const index = leads.findIndex((l) => l.id === id || l.codigoFormatado === id);
      if (index === -1) {
        return res.status(404).json({ error: "Atendimento n\xE3o encontrado." });
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      leads[index].status = status;
      leads[index].updatedAt = now;
      if (status === "CONVERTIDO") {
        leads[index].convertidoAt = now;
        if (valorConversao) {
          leads[index].valorConversao = Number(valorConversao);
        }
      } else if (status === "RECUPERADO_ATENDIMENTO") {
        leads[index].recuperadoAt = now;
      } else if (status === "WHATSAPP_INICIADO") {
        leads[index].whatsappClickedAt = leads[index].whatsappClickedAt || now;
      }
      if (observacoes !== void 0) {
        leads[index].observacoes = String(observacoes);
      }
      await saveLeads(leads);
      console.log(`[Status Atualizado] ${leads[index].codigoFormatado} -> ${status}`);
      res.json({
        success: true,
        lead: leads[index]
      });
    } catch (err) {
      console.error("Erro ao atualizar status do lead:", err);
      res.status(500).json({ error: "Erro ao atualizar status." });
    }
  });
  app.patch("/api/leads/:id/convert", async (req, res) => {
    try {
      const { id } = req.params;
      const { valorConversao, observacoes } = req.body;
      const leads = await loadLeads();
      const index = leads.findIndex((l) => l.id === id || l.codigoFormatado === id);
      if (index === -1) {
        return res.status(404).json({ error: "Atendimento n\xE3o encontrado." });
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      leads[index].status = "CONVERTIDO";
      leads[index].convertidoAt = now;
      leads[index].updatedAt = now;
      if (valorConversao) {
        leads[index].valorConversao = Number(valorConversao);
      }
      if (observacoes) {
        leads[index].observacoes = String(observacoes);
      }
      await saveLeads(leads);
      console.log(`[Venda/F\xF3rmula CONVERTIDA!] ${leads[index].codigoFormatado} - ${leads[index].nome}`);
      res.json({
        success: true,
        lead: leads[index]
      });
    } catch (err) {
      console.error("Erro ao converter lead:", err);
      res.status(500).json({ error: "Erro ao registrar convers\xE3o." });
    }
  });
  app.patch("/api/leads/:id/contacted", async (req, res) => {
    try {
      const { id } = req.params;
      const { observacoes } = req.body;
      const leads = await loadLeads();
      const index = leads.findIndex((l) => l.id === id || l.codigoFormatado === id);
      if (index === -1) {
        return res.status(404).json({ error: "Atendimento n\xE3o encontrado." });
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      leads[index].status = "RECUPERADO_ATENDIMENTO";
      leads[index].recuperadoAt = now;
      leads[index].updatedAt = now;
      if (observacoes) {
        leads[index].observacoes = String(observacoes);
      }
      await saveLeads(leads);
      res.json({
        success: true,
        lead: leads[index]
      });
    } catch (err) {
      console.error("Erro ao marcar como contatado:", err);
      res.status(500).json({ error: "Erro ao atualizar." });
    }
  });
  app.get("/api/dashboard/metrics", async (req, res) => {
    try {
      const leads = await loadLeads();
      const avaliacoesConcluidas = leads.length;
      const whatsappIniciado = leads.filter((l) => l.status === "WHATSAPP_INICIADO").length;
      const aguardandoWhatsapp = leads.filter((l) => l.status === "QUALIFICADO_AGUARDANDO_WHATSAPP").length;
      const convertidos = leads.filter((l) => l.status === "CONVERTIDO").length;
      const recuperados = leads.filter((l) => l.status === "RECUPERADO_ATENDIMENTO").length;
      const totalContatadosOuIniciados = whatsappIniciado + convertidos + recuperados;
      const taxaConversao = avaliacoesConcluidas > 0 ? Math.round(totalContatadosOuIniciados / avaliacoesConcluidas * 1e3) / 10 : 0;
      const taxaVendaFinal = totalContatadosOuIniciados > 0 ? Math.round(convertidos / totalContatadosOuIniciados * 1e3) / 10 : 0;
      res.json({
        success: true,
        metrics: {
          avaliacoesIniciadas: Math.max(avaliacoesConcluidas + 8, 12),
          avaliacoesConcluidas,
          usuariosQualificados: avaliacoesConcluidas,
          whatsappIniciado,
          aguardandoWhatsapp,
          convertidos,
          taxaConversao,
          taxaVendaFinal
        }
      });
    } catch (err) {
      console.error("Erro ao calcular m\xE9tricas:", err);
      res.status(500).json({ error: "Erro ao obter m\xE9tricas." });
    }
  });
  app.post("/api/leads/seed-demo", async (req, res) => {
    return res.status(404).json({ error: "Rota desativada." });
    try {
      const demoData = [
        {
          id: "clq_1084_fp",
          codigoFormatado: "#FP-1084",
          nome: "Mariana Silveira",
          telefone: "21988223344",
          tipoFormula: "Medicamento Manipulado",
          possuiReceita: "J\xE1 possuo receita m\xE9dica",
          localizacao: "Niter\xF3i (Icara\xED)",
          objetivo: "F\xF3rmula personalizada",
          conhecimentoFormula: "J\xE1 tenho a f\xF3rmula prescrita",
          status: "QUALIFICADO_AGUARDANDO_WHATSAPP",
          origem: "landing_page_quiz",
          createdAt: new Date(Date.now() - 25 * 60 * 1e3).toISOString(),
          updatedAt: new Date(Date.now() - 25 * 60 * 1e3).toISOString(),
          whatsappClickedAt: null,
          recuperadoAt: null,
          convertidoAt: null,
          valorConversao: null,
          observacoes: null
        },
        {
          id: "clq_1082_fp",
          codigoFormatado: "#FP-1082",
          nome: "Carlos Eduardo Nogueira",
          telefone: "21971234567",
          tipoFormula: "Suplementa\xE7\xE3o / Vitaminas",
          possuiReceita: "Ainda n\xE3o possuo receita",
          localizacao: "S\xE3o Gon\xE7alo (Centro)",
          objetivo: "Suplementa\xE7\xE3o para treino e imunidade",
          conhecimentoFormula: "Gostaria de falar com o time",
          status: "QUALIFICADO_AGUARDANDO_WHATSAPP",
          origem: "landing_page_quiz",
          createdAt: new Date(Date.now() - 95 * 60 * 1e3).toISOString(),
          updatedAt: new Date(Date.now() - 95 * 60 * 1e3).toISOString(),
          whatsappClickedAt: null,
          recuperadoAt: null,
          convertidoAt: null,
          valorConversao: null,
          observacoes: null
        },
        {
          id: "clq_1080_fp",
          codigoFormatado: "#FP-1080",
          nome: "Luciana Martins Pereira",
          telefone: "21998765432",
          tipoFormula: "Dermocosm\xE9ticos & Cuidado Facial",
          possuiReceita: "J\xE1 possuo receita m\xE9dica",
          localizacao: "Niter\xF3i (Ing\xE1)",
          objetivo: "Cuidados anti-idade e clareador",
          conhecimentoFormula: "Prescri\xE7\xE3o de dermatologista",
          status: "CONVERTIDO",
          // Convertido em venda
          origem: "landing_page_quiz",
          createdAt: new Date(Date.now() - 150 * 60 * 1e3).toISOString(),
          updatedAt: new Date(Date.now() - 40 * 60 * 1e3).toISOString(),
          whatsappClickedAt: new Date(Date.now() - 148 * 60 * 1e3).toISOString(),
          recuperadoAt: null,
          convertidoAt: new Date(Date.now() - 40 * 60 * 1e3).toISOString(),
          valorConversao: 184.5,
          observacoes: "Or\xE7amento aprovado. Entregue na filial Icara\xED."
        },
        {
          id: "clq_1079_fp",
          codigoFormatado: "#FP-1079",
          nome: "Beatriz Vasconcelos",
          telefone: "21995432198",
          tipoFormula: "Dermocosm\xE9ticos & Cuidado Facial",
          possuiReceita: "J\xE1 possuo receita m\xE9dica",
          localizacao: "Niter\xF3i (Santa Rosa)",
          objetivo: "Cuidados com a pele e manchas",
          conhecimentoFormula: "Tenho indica\xE7\xE3o de dermatologista",
          status: "QUALIFICADO_AGUARDANDO_WHATSAPP",
          origem: "landing_page_quiz",
          createdAt: new Date(Date.now() - 180 * 60 * 1e3).toISOString(),
          updatedAt: new Date(Date.now() - 180 * 60 * 1e3).toISOString(),
          whatsappClickedAt: null,
          recuperadoAt: null,
          convertidoAt: null,
          valorConversao: null,
          observacoes: null
        },
        {
          id: "clq_1065_fp",
          codigoFormatado: "#FP-1065",
          nome: "Rodrigo Fontes",
          telefone: "21981112233",
          tipoFormula: "Medicamento Manipulado",
          possuiReceita: "J\xE1 possuo receita m\xE9dica",
          localizacao: "Rio de Janeiro (Outra regi\xE3o)",
          objetivo: "F\xF3rmula personalizada",
          conhecimentoFormula: "J\xE1 tenho a f\xF3rmula",
          status: "WHATSAPP_INICIADO",
          origem: "landing_page_quiz",
          createdAt: new Date(Date.now() - 240 * 60 * 1e3).toISOString(),
          updatedAt: new Date(Date.now() - 239 * 60 * 1e3).toISOString(),
          whatsappClickedAt: new Date(Date.now() - 239 * 60 * 1e3).toISOString(),
          recuperadoAt: null,
          convertidoAt: null,
          valorConversao: null,
          observacoes: "Em negocia\xE7\xE3o de envio por motoboy"
        }
      ];
      await saveLeads(demoData);
      res.json({ success: true, count: demoData.length });
    } catch (err) {
      res.status(500).json({ error: "Erro ao gerar dados demo." });
    }
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa",
      root: FRONTEND_DIR
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(FRONTEND_DIR, "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  const listen = (port) => {
    const server = app.listen(port, "0.0.0.0", () => {
      console.log(`\u{1F680} Formula Plus Server running on http://localhost:${port}`);
    });
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" && !process.env.PORT) {
        console.warn(`Porta ${port} j\xE1 est\xE1 em uso. Tentando a porta ${port + 1}...`);
        listen(port + 1);
        return;
      }
      console.error(`N\xE3o foi poss\xEDvel iniciar o servidor na porta ${port}:`, error);
      process.exitCode = 1;
    });
  };
  listen(PORT);
}
startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
//# sourceMappingURL=server.cjs.map
