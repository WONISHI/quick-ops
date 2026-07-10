我打算在我的vscode插件中也引入插件的思想，
这个插件的思想主要处理的场景是跨模块非工具类的非解析类utils的方法，简单来说我有很多模块需要都需要有创建webview的场景，但是单独写成utils工具函数有点与utils有点格格不入所以打算引入插件思想，插件主要处理多个模块需要涉及到功能的模块方法

vscode插件中也引入插件的思想（后续称它为ETI）的实现逻辑是这样的
里面有插件本体也就是ETI、以及core、loader、plugins三部分组成

ETI里面实现的功能是在我nestjs风格的vscode插件未处理任何模块的时候初始化，主要的工作是加载loader，

loader也是一个类但是他有几个最关键的技术有load方法和export初始化先执行loader.load(加载路径),它是异步的，先加载plugins下的也就是传入的参数是plugins的路径，使用await等待加载完成，再通过loader.export获取加载完成后的结果，里面会返回下面的结果

{
    type:'plugins',
    plugins:[
        {
            pluginId:'XXX',
            on:[
                {
                    name:'xxx',
                    callback:()=>xxx
                        }
                    ]
                }
        ],
        ....
}


loader会先收集plugins下所有方法(也就是通过webpack去获取plugins下的文件然后获取里面的类去执行）然后初始化收集初始化返回的值
初始化返回的值是这样的结构

```js
{
    pluginId:'XXX',
    on:[
        {
            name:'xxx',
            callback:()=>xxx
        }
    ]
}
```

初始化完所有的plugins后ETI会把这个数据收起来

{
    type:'plugins',
    plugins:[
        {
            pluginId:'XXX',
            on:[
                {
                    name:'xxx',
                    callback:()=>xxx
                        }
                    ]
        }，
        ....
    ],
}
到ETI的this.plugins,this.plugins里面的值是


            pluginId:'XXX',
            on:[
                {
                    name:'xxx',
                    callback:()=>xxx
                        }
                    ]
        }，
        ....
    ],

顺便会把on里面的参数抽离出来存放到this.on里面他是一个对象key是name会把this.plugins相同的name合并再一起当成value，方便后面好取值

加载完成plugins开始加载core，core主要是模板流里面有两个主要方法provide和inject，加载core是直接调用provide他会返回下面的值


```js
{
    coreId:'XXX',
    register:[
        {
            name:'xxx',
            callback:()=>xxx
        }
    ]
}
```
注册哪些可以被plugins调用的工作流事件，name就是工作量事件

加载完成所有的core



