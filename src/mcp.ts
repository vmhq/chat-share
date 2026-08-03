import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { z } from "zod";
import {
  createSharedChat,
  getChat,
  listChats,
  suspendChat,
  activateChat,
  deleteChat,
} from "./service";
import { baseUrl } from "./util";
import { rowToPublic } from "./db";

const messagesSchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant", "system", "tool", "reasoning"]),
      content: z.string().min(1),
      name: z.string().max(200).optional(),
      ts: z.number().int().optional(),
    })
  )
  .min(1)
  .max(500);

const shareInputSchema = {
  title: z.string().min(1).max(200),
  messages: messagesSchema,
  password: z.string().min(1).max(200).optional(),
  expires_in: z
    .union([
      z.enum(["1h", "24h", "7d", "30d", "never"]),
      z.string().regex(/^\d+\s*(m|h|d)$/i),
    ])
    .optional(),
  agent: z.string().min(1).max(100).optional(),
};

export async function handleMcpRequest(request: Request, authInfo?: AuthInfo): Promise<Response> {
  const server = new McpServer(
    {
      name: "chat-share",
      version: "0.1.0",
    },
    {
      capabilities: { tools: {} },
    }
  );

  server.registerTool(
    "share_conversation",
    {
      description:
        "Publica una conversación y devuelve un enlace compartible. " +
        "IMPORTANTE: si el usuario no indicó contraseña ni expiración, pregúntale primero " +
        "si quiere proteger el enlace con contraseña y/o con un tiempo de expiración " +
        "(1h, 24h, 7d, 30d o nunca) antes de llamar a esta herramienta.",
      inputSchema: shareInputSchema,
    },
    async (args, extra) => {
      const title = args.title;
      // Identidad del cliente autenticado (OAuth/API key via authInfo)
      const who =
        extra.authInfo?.extra?.email ?? extra.authInfo?.extra?.sub ?? args.agent ?? "mcp";
      const result = await createSharedChat({
        title,
        messages: args.messages,
        password: args.password,
        expires_in: args.expires_in,
        agent: typeof who === "string" ? who : "mcp",
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Conversación publicada: ${title}\nURL: ${result.url}\nExpira: ${result.expires_at ?? "nunca"}\nProtegida: ${result.password_protected ? "sí (requiere contraseña)" : "no"}`,
          },
        ],
      };
    }
  );

  // Listar todos los chats compartidos.
  server.registerTool(
    "list_shared_chats",
    {
      description:
        "Lista los chats compartidos (incluye suspendidos; los eliminados ya no existen). Devuelve id, título, estado, vistas y fechas.",
      inputSchema: { limit: z.number().int().min(1).max(200).optional() },
    },
    ({ limit }) => {
      const rows = listChats(limit ?? 100);
      const items = rows.map((r) => rowToPublic(r, baseUrl()));
      return {
        content: [
          {
            type: "text" as const,
            text: items.length
              ? JSON.stringify(items, null, 2)
              : "No hay chats compartidos.",
          },
        ],
      };
    }
  );

  // Suspender: deja de ser público pero no se borra.
  server.registerTool(
    "suspend_shared_chat",
    {
      description:
        "Suspende un enlace compartido: deja de ser público, pero NO se borra. Puedes reactivarlo después con activate_shared_chat.",
      inputSchema: { id: z.string().min(1) },
    },
    ({ id }) => {
      const ok = suspendChat(id);
      return {
        content: [
          {
            type: "text" as const,
            text: ok ? `Enlace ${id} suspendido (no es público hasta reactivarlo).` : `No se encontró el enlace ${id}.`,
          },
        ],
      };
    }
  );

  // Reactivar: vuelve a estar público.
  server.registerTool(
    "activate_shared_chat",
    {
      description: "Reactiva un enlace suspendido: vuelve a ser público.",
      inputSchema: { id: z.string().min(1) },
    },
    ({ id }) => {
      const ok = activateChat(id);
      return {
        content: [
          { type: "text" as const, text: ok ? `Enlace ${id} reactivado.` : `No se encontró el enlace ${id}.` },
        ],
      };
    }
  );

  // Eliminar: borrado físico.
  server.registerTool(
    "delete_shared_chat",
    {
      description: "Elimina definitivamente un enlace compartido (borrado físico, no se puede recuperar).",
      inputSchema: { id: z.string().min(1) },
    },
    ({ id }) => {
      const ok = deleteChat(id);
      return {
        content: [
          { type: "text" as const, text: ok ? `Enlace ${id} eliminado definitivamente.` : `No se encontró el enlace ${id}.` },
        ],
      };
    }
  );

  // Alias de compatibilidad: revoke → suspend.
  server.registerTool(
    "revoke_shared_chat",
    {
      description:
        "Alias de suspend_shared_chat: suspende un enlace compartido (deja de ser público, no se borra).",
      inputSchema: { id: z.string().min(1) },
    },
    ({ id }) => {
      const ok = suspendChat(id);
      return {
        content: [
          {
            type: "text" as const,
            text: ok ? `Enlace ${id} suspendido (no es público hasta reactivarlo).` : `No se encontró el enlace ${id}.`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_shared_chat_info",
    { description: "Obtiene metadatos de un enlace compartido (vistas, expiración, estado).", inputSchema: { id: z.string().min(1) } },
    async ({ id }) => {
      const row = getChat(id);
      if (!row) {
        return {
          content: [{ type: "text" as const, text: `No se encontró el enlace ${id}.` }],
        };
      }
      const info = rowToPublic(row, baseUrl());
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(info, null, 2),
          },
        ],
      };
    }
  );

  // Modo stateless: transport nuevo por request, sin sessionIdGenerator.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return transport.handleRequest(request, authInfo ? { authInfo } : undefined);
}
