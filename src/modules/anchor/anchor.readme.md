# anchor.readme

# anchor.readme

# anchor.readme

# anchor.readme

controller.ts：负责接收事件 / 命令 / webview message
service.ts：负责业务逻辑
provider.ts：负责 VS Code TreeView / WebviewView / FileSystemProvider 等 UI 或能力提供
module.ts：负责把 controller、service、provider 注册起来
extension.ts：负责启动整个应用

1. 先从controller.ts开始

* 获取插件上下文
* 初始化service层
  * 赋值插件上下文
  * 加载工作区的锚点
    * 获取锚点
    * 获取分组
    * 获取子分组
    * 获取拍平的锚点数据
    * 触发event emit
* 注册当前模块设计的provider
  * 调用service层的createCodeLensProvider
  * 初始化provider和provideCodeLenses
  * 监听service的event emit
* 注册当前模块涉及的事件
* 注册当前模块命令
* 设置插件变量
