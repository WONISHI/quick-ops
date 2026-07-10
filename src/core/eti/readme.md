# ETI (Extension Trigger Infrastructure) 设计文档

## 1. 概述

ETI 是运行在 NestJS 风格 VSCode 插件架构上的内部扩展运行时。

主要解决跨模块能力复用问题：

- Webview 创建
- 全局事件
- 命令扩展
- 生命周期管理
- 状态管理

这些能力不属于业务模块，也不适合放入 utils，因此通过 Plugin + Core + Loader 的方式管理。

---

# 2. 整体架构

```text
extension.activate()

        |
        |
       ETI.init()

        |
        |
       Loader

        |
 -------------------
 |                 |
Plugin            Core
```

---

# 3. 初始化流程

```text
extension.activate()

        |

ETI.init()

        |

loader.load()

        |

loader.export()

        |

注册 plugins

        |

加载 core

        |

core.provide()

        |

收集 register

        |

core.inject()

        |

执行 ETI.ready()

        |

触发 this.on.ready

```

---

# 4. Loader

Loader负责：

1. 扫描 plugins
2. 加载插件类
3. 实例化插件
4. 执行初始化
5. 收集插件返回结果

Plugin返回：

```ts
{
 pluginId:'xxx',

 on:[
   {
     name:'xxx',
     callback:()=>{}
   }
 ]
}
```

---

# 5. ETI插件管理

Loader完成后：

```ts
this.plugins
```

保存完整插件信息。


同时生成：

```ts
this.on
```

结构：

```ts
{
 ready:[
   callback1,
   callback2
 ],

 moduleInitReady:[
   callback
 ]
}
```

同名事件自动合并。

---

# 6. Core

Core负责定义工作流。

Core通过：

```ts
provide()
```

提供能力。


返回：

```ts
{
 coreId:'xxx',

 register:[
   {
    name:'xxx',
    callback:()=>{}
   }
 ]
}
```

---

# 7. Core inject

ETI匹配：

```text
plugin.on.name

        ==

core.register.name
```

匹配成功后，将 Plugin 能力注入 Core。

---

# 8. Plugin生命周期

## ready

插件创建前。

流程：

```text
ETI.ready()

    |

this.on.ready()
```

---

## readied

插件创建后。

流程：

```text
所有模块初始化完成

        |

ETI.readied()

        |

this.on.readied()
```

---

## disposed

插件卸载后。

流程：

```text
所有模块销毁完成

        |

ETI.disposed()

        |

this.on.disposed()
```

---

# 9. Module生命周期

Module生命周期由ETI代理。

## 初始化

完整流程：

```text
模块调用 onModuleInit 前

        |

ETI.moduleInitReady()

        |

触发 this.on.moduleInitReady

        |

执行 module.onModuleInit

        |

获取返回值

        |

触发 this.on.moduleInitReadied

        |

注入返回参数

        |

所有模块完成

        |

ETI.readied()

```

---

# 10. Module卸载流程

```text
模块调用 dispose 前

        |

ETI.moduleDispose()

        |

触发 this.on.moduleDispose

        |

执行 module.dispose

        |

触发 this.on.moduleDisposed

        |

所有模块销毁完成

        |

ETI.disposed()

```

---

# 11. 生命周期总览

```text
ETI.init()

 |
 |
Plugin加载

 |
 |
Core加载

 |
 |
core.inject()

 |
 |
Plugin ready
(插件创建前)

 |
 |
moduleInitReady
(模块创建前)

 |
 |
module.onModuleInit()

 |
 |
moduleInitReadied
(模块创建后)

 |
 |
Plugin readied
(插件创建后)


====================


moduleDispose
(模块卸载前)

 |
 |
module.dispose()

 |
 |
moduleDisposed
(模块卸载后)

 |
 |
Plugin disposed
(插件卸载后)

```

---

# 12. ETI职责

ETI负责：

1. Plugin动态加载
2. Core动态加载
3. Plugin事件管理
4. Core能力注册
5. Plugin与Core绑定
6. Module生命周期代理
7. 全局生命周期调度


---

# 13. 核心思想

ETI：

- Plugin 提供扩展能力
- Core 提供业务流程
- Loader 负责发现和加载
- ETI 负责连接和调度


结构：

```text
                 ETI

                  |

       ----------------------

       |                    |

    Plugin                Core

       |                    |

 扩展能力              工作流

       \                /

        \              /

          生命周期事件

                  |

              Module

```
