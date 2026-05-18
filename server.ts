import express from "express";
import path from "path";
import cors from "cors";
import axios from "axios";
import https from "https";
import dns from "dns";
import fs from "fs";
import { promisify } from "util";
import { createServer as createViteServer } from "vite";

const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '8.8.4.4']);
const resolve4 = promisify(resolver.resolve4.bind(resolver));

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API Health check
  app.get("/api/status", (req, res) => {
    res.json({ 
      status: "online", 
      proxy_ready: true,
      protocol: req.protocol,
      cwd: process.cwd(),
      env: process.env.NODE_ENV
    });
  });

  // Debug route to list dist contents
  app.get("/api/debug-dist", (req, res) => {
    try {
      const distPath = path.resolve(process.cwd(), 'dist');
      if (fs.existsSync(distPath)) {
        res.json({ exists: true, contents: fs.readdirSync(distPath) });
      } else {
        res.json({ exists: false, path: distPath });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Custom resolver for problematic domains like duckdns.org
  async function getTargetUrlWithIp(originalUrl: string): Promise<{ url: string, host: string }> {
    try {
      const urlObj = new URL(originalUrl);
      const hostname = urlObj.hostname;
      
      // Only use custom DNS for duckdns.org to avoid breaking other things
      if (hostname.endsWith('duckdns.org')) {
        console.log(`[DNS] Resolviendo manual para ${hostname}...`);
        const ips = await resolve4(hostname);
        if (ips && ips.length > 0) {
          const ip = ips[0];
          urlObj.hostname = ip;
          console.log(`[DNS] ${hostname} -> ${ip}`);
          return { url: urlObj.toString(), host: hostname };
        }
      }
      return { url: originalUrl, host: hostname };
    } catch (e) {
      return { url: originalUrl, host: "" };
    }
  }

  // Proxy endpoint to bypass Mixed Content (HTTP on HTTPS)
  app.options("/api/proxy", cors()); // Explicitly handle OPTIONS for proxy
  app.all("/api/proxy", async (req: express.Request, res: express.Response) => {
    const targetUrlRaw = req.query.url as string;
    
    if (!targetUrlRaw) {
      return res.status(400).json({ error: "Falta el parámetro 'url' en el proxy" });
    }

    try {
      const targetMethod = req.method;
      const { url: targetUrl, host: targetHost } = await getTargetUrlWithIp(targetUrlRaw);
      
      console.log(`[Proxy] INICIO: ${targetMethod} -> ${targetUrl} (Original: ${targetUrlRaw})`);
      
      const axiosHeaders: Record<string, string> = {
        'Accept': 'application/json',
        'User-Agent': 'TitanBoard-Industrial/1.0',
      };

      if (targetMethod !== 'GET' && targetMethod !== 'HEAD') {
        axiosHeaders['Content-Type'] = 'application/json';
      }

      const axiosConfig: any = {
        method: targetMethod as any,
        url: targetUrl,
        headers: axiosHeaders,
        timeout: 25000,
        maxRedirects: 0,
        validateStatus: () => true,
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        })
      };

      if (targetHost) {
        axiosConfig.headers['Host'] = targetHost;
      }

      if (targetMethod !== 'GET' && targetMethod !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
        // If it's a POST/PUT with body
        axiosConfig.data = req.body;
      }

      if (req.headers['x-authorization'] || req.headers['X-Authorization']) {
        axiosConfig.headers['X-Authorization'] = req.headers['x-authorization'] || req.headers['X-Authorization'];
      }

      const response = await axios(axiosConfig);
      console.log(`[Proxy Successful] Status: ${response.status} from ${targetUrl}`);
      res.status(response.status).send(response.data);
    } catch (error: any) {
      if (error.response) {
        console.error(`[Proxy Error Response] ${error.response.status} from ${targetUrlRaw}`);
        return res.status(error.response.status).send(error.response.data);
      }
      console.error(`[Proxy Fatal Network]: ${error.message} for ${targetUrlRaw}`);
      res.status(502).json({ 
        message: "Error de conexión con el servidor externo. Verifica si el servidor está en línea.", 
        details: error.message,
        code: error.code
      });
    }
  });

  // Handle production vs development
  const isProd = process.env.NODE_ENV === 'production';
  const distPath = path.join(process.cwd(), 'dist');

  if (isProd && fs.existsSync(distPath)) {
    console.log(`[Production] serving from: ${distPath}`);
    app.use(express.static(distPath));
    
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) return res.status(404).json({ error: "Endpoint not found" });
      
      const indexPath = path.join(distPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send(`Error: index.html not found in dist.`);
      }
    });
  } else {
    console.log("[Dev] Starting Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
