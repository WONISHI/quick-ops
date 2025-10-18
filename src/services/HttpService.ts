import express, { Request, Response, Express, NextFunction } from 'express';
import Mock from 'mockjs';
import { generateUUID } from '../utils/index';
import { isUndefined, isObject } from './../utils/is';
import type { HttpServiceOptions, HttpServiceTemplate, MockRoute, MethodType } from '../types/utils';

class HttpService {
  // 服务集合
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
  private findRoute(port: number, id: string) {
    const server = this.findServer(port);
    if (!server) return null;
    return server.routes.find((r) => r.id === id);
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
    const id = `server_id_${generateUUID(12)}`;

    if (!server) {
      console.warn(`⚠️ 端口 ${port} 的服务不存在，正在创建...`);
      this.createServer(port);
      return this.addRoute(options);
    }

    const template = options.template || [];
    const isObject = !isUndefined(options.isObject) ? options.isObject : false;
    const code = options.code ?? 200;
    const message = options.message ?? '成功';
    const status = options.status ?? true;
    const active = options.active ?? true;

    const handler = (req: Request, res: Response) => {
      const route = this.findRoute(port, id);
      if (route) {
        const mockRules = this.buildMockRules(route.template);
        const data = route.isObject ? Mock.mock(mockRules) : Mock.mock({ 'list|5-10': [mockRules] }).list;
        res.send({ code: route.code, data, status: route.status, message: route.message });
      } else {
        const mockRules = this.buildMockRules(template);
        const data = isObject ? Mock.mock(mockRules) : Mock.mock({ 'list|5-10': [mockRules] }).list;
        res.send({ code, data, status, message });
      }
    };

    const wrapper = (req: Request, res: Response, next: NextFunction) => {
      const route = this.findRoute(port, id);
      if (!route) return res.status(404).send('服务未找到');
      if (!route.active) return res.status(403).send('服务已停用');
      handler(req, res);
    };

    (server.app as any)[method](routePath, wrapper);

    server.routes.push({ path: routePath, status, id, code, message, method, handler, active, template, isObject });
    console.log(`✅ 已注册路由: [${method.toUpperCase()}] http://localhost:${port}${routePath}`);

    return { port, route: routePath, id, method, active, code, message, status, isObject, template };
  }

  /** 启停路由 */
  toggleServer(options: HttpServiceOptions) {
    const port = options.port || this.defaultPort;
    const routePath = options.route;
    const method = (options.method || 'all').toLowerCase();

    const route = this.findRoute(port, options.id);
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
    const server = this.findServer(port);
    if (!server) return console.warn(`未找到服务: ${port}`);
    const index = server.routes.findIndex((r) => r.id === options.id);
    if (index === -1) return console.warn(`未找到路由: ${routePath}`);
    const old = server.routes[index];
    const updated = {
      ...old,
      template: options.template ?? old.template,
      isObject: options.isObject ?? old.isObject,
      code: options.code ?? old.code,
      status: options.status ?? old.status,
      message: options.message ?? old.message,
      active: options.active ?? old.active,
      path: options.route ?? old.path,
      method: options.method ?? old.method,
    };
    // ✅ 替换数组中的引用
    server.routes[index] = updated;
    console.log(`📝 路由 [${method.toUpperCase()}] ${routePath} 的模板已更新`);
  }

  /** 删除路由 */
  removeRoute(options: HttpServiceOptions): boolean {
    const { port, id, method, route } = options;
    const upperMethod = method!.toUpperCase();
    const server = this.findServer(port!);
    if (!server) return false;
    const index = server.routes.findIndex((r) => r.id === id);
    server.routes.splice(index, 1);
    console.log(`❌ 已删除路由: [${upperMethod}] http://localhost:${port}${route}`);
    return true;
  }

  /** 查看已注册路由 */
  listRoutes(port?: number) {
    if (port) {
      const server = this.findServer(port);
      return server ? server.routes : [];
    }
    return this.servers.flatMap((s) => s.routes.map((r) => ({ port: s.port, ...r })));
  }
}

export default new HttpService();
