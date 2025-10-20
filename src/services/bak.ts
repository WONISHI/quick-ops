import express, { Request, Response, Express } from 'express';
import Mock from 'mockjs';
import { generateUUID } from '../utils/index';
import type { HttpServiceOptions } from '../types/utils';

class MockBuilder {
  build(template: any[], isObject = false) {
    const rules = Object.fromEntries(template.map(t => [t.key, `@${t.value}`]));
    return isObject ? Mock.mock(rules) : Mock.mock({ 'list|5-10': [rules] }).list;
  }
}

class HttpRoute {
  id = generateUUID(12);
  constructor(public config: HttpServiceOptions, private mockBuilder: MockBuilder) {}

  handle(req: Request, res: Response) {
    const data = this.mockBuilder.build(this.config.template || [], this.config.isObject);
    res.json({ code: this.config.code, data, status: this.config.status, message: this.config.message });
  }
}

class HttpServer {
  routes: HttpRoute[] = [];
  constructor(public port: number, public app: Express = express()) {
    app.use(express.json());
    app.listen(port, () => console.log(`✅ Server running on http://localhost:${port}`));
  }

  registerRoute(route: HttpRoute) {
    const method = (route.config.method || 'all').toLowerCase();
    (this.app as any)[method](route.config.route!, route.handle.bind(route));
    this.routes.push(route);
    console.log(`✅ Added route [${method.toUpperCase()}] ${route.config.route}`);
  }
}

class HttpService {
  private servers = new Map<number, HttpServer>();
  private mockBuilder = new MockBuilder();

  ensureServer(port = 9527) {
    if (!this.servers.has(port)) this.servers.set(port, new HttpServer(port));
    return this.servers.get(port)!;
  }

  addRoute(options: HttpServiceOptions) {
    const server = this.ensureServer(options.port);
    const route = new HttpRoute(options, this.mockBuilder);
    server.registerRoute(route);
    return route;
  }
}

export default new HttpService();
