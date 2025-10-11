import { isUndefined } from './../utils/is';
import express, { Request, Response, Express, NextFunction } from 'express';
import Mock from 'mockjs';
import { generateUUID } from '../utils/index';
import type { HttpServiceOptions, HttpServiceTemplate, MockRoute } from '../types/utils';

class HttpService {
  private servers: { port: number; app: Express; routes: MockRoute[] }[] = [];

  constructor(private defaultPort = 9527) {
    // 创建默认服务
    this.createServer(this.defaultPort);
  }

  /**
   * 创建服务
   */
  createServer(port: number) {
    const app = express();
    app.use(express.json());

    app.listen(port, () => {
      console.log(`HTTP 服务运行在 http://localhost:${port}`);
    });

    this.servers.push({ port, app, routes: [] });
  }

  /**
   * 查找服务实例
   */
  private findServer(port: number) {
    return this.servers.find((s) => s.port === port);
  }

  /**
   * 生成 Mock.js 的规则对象
   */
  private buildMockRules(template: HttpServiceTemplate[]): Record<string, any> {
    const rules: Record<string, any> = {};
    template.forEach((tpl: HttpServiceTemplate) => {
      if (!tpl.key || !tpl.type || !tpl.value) return;
      const rule = this.resolveMockRule(tpl);
      rules[tpl.key] = rule;
    });
    return rules;
  }

  /**
   * 将模板项转成 Mock.js 规则
   */
  private resolveMockRule(tpl: HttpServiceTemplate): any {
    const { type, value } = tpl;
    return `@${value}`;
  }

  /**
   * 动态添加路由
   */
  addRoute(options: HttpServiceOptions): any {
    const port = options.port || this.defaultPort;
    const routePath = options.route || `/api/${generateUUID(12)}`;
    const method = options.method || 'all';
    const template = options.template || [];
    const isObject = isUndefined(options.isObject) ? false : true;
    const code = isUndefined(options.code) ? 200 : options.code;
    const message = isUndefined(options.message) ? '成功' : options.message;
    const status = isUndefined(options.status) ? true : options.status;
    const active = isUndefined(options.active) ? true : options.active;
    let data: any;

    const server = this.findServer(port);

    if (!server) {
      console.warn(`端口 ${port} 的服务不存在，正在创建...`);
      this.createServer(port);
      return this.addRoute(options); // 递归注册
    }

    const handler = (req: Request, res: Response) => {
      const mockRules = this.buildMockRules(template);

      if (isObject) {
        data = Mock.mock(mockRules);
      } else {
        data = Mock.mock({
          'list|5-10': [mockRules],
        }).list;
      }

      res.send({
        code,
        data,
        status,
        message,
      });
    };

    // 包装中间件：控制启用状态 + 执行用户中间件
    const wrapper = async (req: Request, res: Response, next: NextFunction) => {
      const route = server.routes.find((r) => r.path === routePath && r.method === method);
      if (!route) return res.status(404).send('服务未找到');
      if (!active || !route.active) return res.status(403).send('服务已被停用');

      handler(req, res);
    };

    // 注册路由
    (server.app as any)[method](routePath, wrapper);

    // 保存路由信息
    server.routes.push({ path: routePath, method, handler, active: true });

    console.log(`已注册路由: [${method.toUpperCase()}] http://localhost:${port}${routePath}`);
    return {
      code,
      port,
      status,
      message,
      method,
      isObject,
      route: routePath,
      active,
    };
  }

  toggleServer(options: HttpServiceOptions) {
    const port = options.port || this.defaultPort;
    const routePath = options.route || `/api/${generateUUID(12)}`;
    const method = options.method || 'all';
    const server = this.findServer(port);
    let route = server!.routes.find((r) => r.path === routePath && r.method === method);
    if (route) {
      route.active = typeof options.active === 'boolean' ? options.active : true;
    }
    return options;
  }

  /**
   * 删除指定路由
   */
  removeRoute(port: number, routePath: string, method: string = 'all'): boolean {
    const server = this.findServer(port);
    if (!server) {
      console.warn(`端口 ${port} 的服务不存在`);
      return false;
    }

    const app: any = server.app;
    const stack = app._router?.stack;
    if (!stack) return false;

    const upperMethod = method.toUpperCase();

    // 从 express 的路由栈中移除匹配的层
    app._router.stack = stack.filter((layer: any) => {
      if (!layer.route) return true; // 非路由层（如中间件）保留
      const match = layer.route.path === routePath && (upperMethod === 'ALL' || layer.route.methods[method]);
      return !match;
    });

    // 同时从记录中移除
    server.routes = server.routes.filter((r) => !(r.path === routePath && (r.method === method || method === 'all')));

    console.log(`已删除路由: [${upperMethod}] http://localhost:${port}${routePath}`);
    return true;
  }

  /**
   * 查看已注册路由
   */
  listRoutes(port?: number) {
    if (port) {
      const server = this.findServer(port);
      return server ? server.routes : [];
    }
    return this.servers.flatMap((s) => s.routes.map((r) => ({ port: s.port, ...r })));
  }
}

export default new HttpService();
