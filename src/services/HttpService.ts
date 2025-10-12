import express, { Request, Response, Express, NextFunction } from 'express';
import Mock from 'mockjs';
import { generateUUID } from '../utils/index';
import { isUndefined } from './../utils/is';
import type { HttpServiceOptions, HttpServiceTemplate, MockRoute,MethodType } from '../types/utils';

class HttpService {
  private servers: { port: number; app: Express; routes: MockRoute[] }[] = [];

  constructor(private defaultPort = 9527) {
    this.createServer(this.defaultPort);
  }

  /** 创建服务实例 */
  private createServer(port: number) {
    const app = express();
    app.use(express.json());

    app.listen(port, () => {
      console.log(`✅ HTTP 服务运行在 http://localhost:${port}`);
    });

    this.servers.push({ port, app, routes: [] });
  }

  /** 查找服务 */
  private findServer(port: number) {
    return this.servers.find((s) => s.port === port);
  }

  /** 查找具体路由 */
  private findRoute(port: number, route: string, method: string) {
    const server = this.findServer(port);
    if (!server) return null;
    return server.routes.find((r) => r.path === route && r.method === method);
  }

  /** 构建 Mock.js 规则 */
  private buildMockRules(template: HttpServiceTemplate[]): Record<string, any> {
    const rules: Record<string, any> = {};
    template.forEach((tpl) => {
      if (!tpl.key || !tpl.type || !tpl.value) return;
      rules[tpl.key] = this.resolveMockRule(tpl);
    });
    return rules;
  }

  private resolveMockRule(tpl: HttpServiceTemplate): any {
    return `@${tpl.value}`;
  }

  /** 添加动态路由 */
  addRoute(options: HttpServiceOptions): any {
    const port = options.port || this.defaultPort;
    const routePath = options.route || `/api/${generateUUID(12)}`;
    const method = (options.method || 'all').toLowerCase() as MethodType;
    const server = this.findServer(port);

    if (!server) {
      console.warn(`⚠️ 端口 ${port} 的服务不存在，正在创建...`);
      this.createServer(port);
      return this.addRoute(options);
    }

    // 避免重复注册
    const existed = this.findRoute(port, routePath, method);
    if (existed) {
      console.warn(`⚠️ 路由 [${method.toUpperCase()}] ${routePath} 已存在，将被覆盖`);
      this.removeRoute(port, routePath, method);
    }

    const template = options.template || [];
    const isObject = !isUndefined(options.isObject) ? options.isObject : false;
    const code = options.code ?? 200;
    const message = options.message ?? '成功';
    const status = options.status ?? true;
    const active = options.active ?? true;

    const handler = (req: Request, res: Response) => {
      const mockRules = this.buildMockRules(template);
      const data = isObject
        ? Mock.mock(mockRules)
        : Mock.mock({ 'list|5-10': [mockRules] }).list;

      res.send({ code, data, status, message });
    };

    const wrapper = (req: Request, res: Response, next: NextFunction) => {
      const route = this.findRoute(port, routePath, method);
      if (!route) return res.status(404).send('服务未找到');
      if (!route.active) return res.status(403).send('服务已停用');
      handler(req, res);
    };

    (server.app as any)[method](routePath, wrapper);

    server.routes.push({ path: routePath, method, handler, active, update: 0 });
    console.log(`✅ 已注册路由: [${method.toUpperCase()}] http://localhost:${port}${routePath}`);

    return { port, route: routePath, method, active, code, message, status, isObject, template };
  }

  /** 启停路由 */
  toggleServer(options: HttpServiceOptions) {
    const port = options.port || this.defaultPort;
    const routePath = options.route;
    const method = (options.method || 'all').toLowerCase();

    const route = this.findRoute(port, routePath!, method);
    if (!route) return console.warn(`未找到路由: ${routePath}`);

    route.active = typeof options.active === 'boolean' ? options.active : !route.active;
    console.log(`🔄 路由 [${method.toUpperCase()}] ${routePath} 已${route.active ? '启用' : '停用'}`);
    return options;
  }

  /** 修改路由返回数据模板 */
  updateRouteData(options: HttpServiceOptions) {
    const port = options.port || this.defaultPort;
    const routePath = options.route;
    const method = (options.method || 'all').toLowerCase();

    const route = this.findRoute(port, routePath!, method);
    if (!route) return console.warn(`未找到路由: ${routePath}`);

    route.update++;
    route.handler = (req: Request, res: Response) => {
      const mockRules = this.buildMockRules(options.template || []);
      const data = options.isObject
        ? Mock.mock(mockRules)
        : Mock.mock({ 'list|5-10': [mockRules] }).list;

      res.send({
        code: options.code ?? 200,
        data,
        status: options.status ?? true,
        message: options.message ?? '成功',
      });
    };

    console.log(`📝 路由 [${method.toUpperCase()}] ${routePath} 的模板已更新`);
  }

  /** 删除路由 */
  removeRoute(port: number, routePath: string, method: string = 'all'): boolean {
    const server = this.findServer(port);
    if (!server) return false;

    const app: any = server.app;
    const upperMethod = method.toUpperCase();

    app._router.stack = app._router.stack.filter((layer: any) => {
      if (!layer.route) return true;
      const match = layer.route.path === routePath && (upperMethod === 'ALL' || layer.route.methods[method]);
      return !match;
    });

    server.routes = server.routes.filter((r) => !(r.path === routePath && r.method === method));
    console.log(`❌ 已删除路由: [${upperMethod}] http://localhost:${port}${routePath}`);
    return true;
  }

  /** 查看已注册路由 */
  listRoutes(port?: number) {
    if (port) {
      const server = this.findServer(port);
      return server ? server.routes : [];
    }
    return this.servers.flatMap((s) =>
      s.routes.map((r) => ({ port: s.port, ...r }))
    );
  }
}

export default new HttpService();
