(function () {
  // 全局注册 Element UI
  Vue.use(ELEMENT);
  Vue.prototype.$bus = new Vue();

  // 定义组件（可以写 template）
  Vue.component('advanced-tabs', {
    props: ['catalogue', 'value'],
    data() {
      return { activeName: 'shell' };
    },
    template: `
      <el-tabs v-model="activeName" @tab-click="handleClick">
        <el-tab-pane
          v-for="(item,index) in catalogue"
          :key="index"
          :label="item.label"
          :name="item.value">
          <slot :name="item.value" :value="item.value" /> 
        </el-tab-pane>
      </el-tabs>
    `,
    methods: {
      handleClick(tab) {
        // 使用 v-model 双向绑定
        this.$emit('input', this.catalogue[tab.index].value);
      },
    },
  });

  // 悬浮菜单
  Vue.component("floating-nav-menu", {
    template: `  
      <div
        class="floating-nav"
        @mouseenter="isExpanded = true"
        @mouseleave="isExpanded = false"
      >
        <div class="nav-inner" :class="{ expanded: isExpanded }">
          <transition-group name="fade" tag="div" class="nav-buttons">
            <button
              v-for="(tool, index) in tools"
              :key="tool.label"
              class="nav-btn"
              :title="tool.label"
              v-show="isExpanded"
              @click="tool.action && tool.action()"
            >
              {{ tool.icon }}
            </button>
          </transition-group>
          <div class="collapse-btn">☰</div>
        </div>
      </div>
    `,
    props: {
      tools: {
        type: Array,
        default: () => [
          { label: "刷新页面", icon: "🔄", action: () => location.reload() },
          {
            label: "返回顶部",
            icon: "⬆️",
            action: () => window.scrollTo({ top: 0, behavior: "smooth" }),
          },
          { label: "设置", icon: "⚙️", action: () => alert("打开设置") },
          { label: "帮助", icon: "❓", action: () => alert("打开帮助") },
        ],
      },
    },
    data() {
      return {
        isExpanded: false,
      };
    },
  })

  // 创建弹窗
  Vue.component('api-creator', {
    props: ['dialogVisible', 'title', 'row'],
    data() {
      return {
        statusCode: [],
        methodCode: [],
        mockCategories: {
          Basic: ['boolean', 'natural', 'integer', 'float', 'character', 'string', 'range'],
          Date: ['date', 'time', 'datetime', 'now'],
          Image: ['img', 'dataImage'],
          Color: ['color', 'hex', 'rgb', 'rgba', 'hsl'],
          Text: ['paragraph', 'sentence', 'word', 'title', 'cparagraph', 'csentence', 'cword', 'ctitle'],
          Name: ['first', 'last', 'name', 'cfirst', 'clast', 'cname'],
          Web: ['url', 'domain', 'protocol', 'tld', 'email', 'ip'],
          Address: ['region', 'province', 'city', 'county', 'zip'],
          Helper: ['capitalize', 'upper', 'lower', 'pick', 'shuffle'],
          Miscellaneous: ['guid', 'id', 'increment'],
        },
        type: 'add',
        httpTemplate: {
          code: 200,
          isObject: false,
          status: true,
          template: [],
          method: 'get',
          route: ''
        },
      };
    },
    template: `
      <el-dialog
        :title="title"
        :visible.sync="dialogVisible"
        width="90%"
        height="90vh"
        :before-close="handleClose">
        <el-form ref="form" :model="httpTemplate" label-width="80px">
          <el-form-item label="路由:">
           <el-input v-model="httpTemplate.route" placeholder="请输入路由"></el-input>
          </el-form-item>
          <el-form-item label="请求方式:">
            <el-select v-model="httpTemplate.method" placeholder="请选择活动区域">
              <el-option :label="item" :value="item" v-for="(item,index) in methodCode" :key="index"></el-option>
            </el-select>
          </el-form-item>
          <el-form-item label="状态码:">
            <el-select v-model="httpTemplate.code" placeholder="请选择活动区域">
              <el-option :label="item" :value="item" v-for="(item,index) in statusCode" :key="index"></el-option>
            </el-select>
          </el-form-item>
          <el-form-item label="是否成功:">
            <el-radio-group v-model="httpTemplate.status">
              <el-radio :label="true">是</el-radio>
              <el-radio :label="false">否</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="数据结构:">
            <el-button-group>
              <el-button :type="httpTemplate.isObject?'primary':'default'" @click="httpTemplate.isObject=true">对象类型</el-button>
              <el-button :type="!httpTemplate.isObject?'primary':'default'" @click="httpTemplate.isObject=false">数组类型</el-button>
            </el-button-group>
            <el-table
              border
              size="mini"
              :data="httpTemplate.template"
              style="width: 100%;margin:10px 0;">
              <el-table-column
                prop="index"
                label="序号"
                width="180">
                <template slot-scope="{ column, $index }">
                  {{$index+1}}
                </template>
              </el-table-column>
              <el-table-column
                prop="key"
                label="key"
                width="180">
                <template slot-scope="{ column, $index }">
                  <el-input v-model="httpTemplate.template[$index].key" placeholder="请输入" />
                </template>
              </el-table-column>
              <el-table-column
                prop="value"
                width="240"
                label="value">
                 <template slot-scope="{ column, $index }">
                  <div class="create-http-value">
                    <el-select v-model="httpTemplate.template[$index].type" placeholder="请选择">
                    <el-option :label="item" :value="item" v-for="(item,index) in Object.keys(mockCategories)" :key="index"></el-option>
                    </el-select>
                    <el-select v-model="httpTemplate.template[$index].value" placeholder="请选择">
                      <el-option :label="item" :value="item" v-for="(item,index) in mockCategories[httpTemplate.template[$index].type]" :key="index"></el-option>
                    </el-select>
                  </div>
                </template>
              </el-table-column>
            </el-table>
            <el-button class="el-icon-plus" @click="add"></el-button>
          </el-form-item>
        </el-form>
        <span slot="footer" class="dialog-footer">
          <el-button @click="handleClose">取 消</el-button>
          <el-button type="primary" @click="ok">确 定</el-button>
        </span>
      </el-dialog>
    `,
    watch: {
      row: {
        immediate: true,
        deep: true,
        handler(newVal) {
          if (Object.keys(newVal).length) {
            this.type = 'edit'
            this.httpTemplate = {
              template: newVal.template,
              code: newVal.code,
              status: newVal.status,
              route: newVal.route,
              method: newVal.method,
              isObject: newVal.isObject,
              id: newVal.id
            }
          } else {
            this.type = 'add'
          }
        }
      }
    },
    mounted() {
      this.$bus.$on('global-data', (data) => {
        this.statusCode = data.globalData.httpStatusCode
        this.methodCode = data.globalData.methodCode
      });
    },
    methods: {
      handleClose() {
        this.isObject = false
        this.httpTemplate = {
          code: 200,
          status: true,
          template: [],
          route: '',
          method: 'get',
          isObject: false
        };
        this.$emit('update:dialogVisible', false);
        this.$emit('update:row', {})
      },
      add() {
        this.httpTemplate.template.push({
          key: '',
          type: '',
          value: '',
        });
      },
      ok() {
        this.$emit('ok', this.httpTemplate, this.type);
        this.handleClose();
      },
    },
  });

  // 根实例
  new Vue({
    el: '#app',
    data: {
      useCatalogue: [
        { label: '指令', value: 'shell' },
        { label: '服务', value: 'service' },
        { label: '设置', value: 'settings' },
      ],
      activeName: 'shell',
      loading: true,
      title: '',
      activeName: 'shell',
      vscode: null,
      dialogVisible: false,
      httpTemplate: {},
      tableData: [],
      serviceData: [],
      currentRow: {},
      enableVisibility: true,
    },
    template: `
      <div class="webview-menu" v-loading="loading">
        <!-- 使用v-model进行绑定 -->
        <!-- #region advanced-tabs -->
        <advanced-tabs :value="activeName" @input="activeName = $event" :catalogue="useCatalogue">
          <template #shell>
            <!-- shell 选项卡的内容 -->
            <div v-show="activeName === 'shell'">
              <el-table :data="tableData" size="mini" style="width: 100%" border>
                <el-table-column
                  prop="index"
                  align="center"
                  label="序号"
                  min-width="10%">
                </el-table-column>
                <el-table-column
                  prop="name"
                  label="指令名称"
                  align="center"
                  min-width="30%">
                </el-table-column>
                <el-table-column
                  min-width="40%"
                  align="center"
                  label="指令">
                  <template slot-scope="scope">
                    <el-tooltip class="item" effect="dark" :content="scope.row.cmd" placement="top">
                      <el-button @click="onRunCommand(scope.row)" type="text" size="small" class="command-display">{{scope.row.cmd}}</el-button>
                    </el-tooltip>
                  </template>
                </el-table-column>
                <el-table-column
                  label="操作"
                  min-width="20%">
                  <template slot-scope="scope">
                    <el-dropdown @command="runInCurrentTerminal($event,scope.row)">
                      <el-button @click="onRunCommand(scope.row)" type="text" size="small">运行</el-button>
                      <el-dropdown-menu slot="dropdown">
                        <el-dropdown-item command="execute-in-current">当前运行</el-dropdown-item>
                        <el-dropdown-item command="execute-with-new-session">新开运行</el-dropdown-item>
                      </el-dropdown-menu>
                    </el-dropdown>
                    <el-button @click="disposeCommand" type="text" size="small">中断运行</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </template>
          <template #service>
            <div class="service-view">
              <div class="service-operate">
                <el-button @click="showCreateServiceModal">创建服务</el-button>
              </div>
               <el-table :data="serviceData" size="mini" style="width: 100%" border>
                <el-table-column
                  prop="index"
                  align="center"
                  label="序号"
                  min-width="10%">
                  <template slot-scope="{ column, $index }">
                    {{$index+1}}
                  </template>
                </el-table-column>
                <el-table-column
                  prop="route"
                  label="路由"
                  align="center"
                  min-width="30%">
                  <template slot-scope="scope">
                    <el-tag type="success">
                      <a class="webview-a" :href="'http://localhost:'+scope.row.port+scope.row.route" :title="'http://localhost:'+scope.row.port+scope.row.route">{{scope.row.route}}</a>
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column
                  min-width="40%"
                  prop="code"
                  align="center"
                  label="code">
                </el-table-column>
                <el-table-column
                  min-width="40%"
                  prop="method"
                  align="center"
                  label="method">
                </el-table-column>
                <el-table-column
                  label="操作"
                  min-width="20%">
                  <template slot-scope="scope">
                    <el-button @click="toggleService(scope.row)" :class="[!scope.row.active?'active-text':'disabled-text']" type="text" size="small">{{scope.row.active?'停用':'启用'}}</el-button>
                    <el-button type="text" size="small" @click="editService(scope.row)">编辑</el-button>
                    <el-button type="text" size="small" @click="deleteService(scope.row)">删除</el-button>
                  </template>
                </el-table-column>
              </el-table>
              <api-creator @ok="handleConfirmService" :dialogVisible.sync="dialogVisible" :title="title" :row.sync="currentRow"></api-creator>
            </div>
          </template>
        </advanced-tabs>
        <!-- #endregion -->
      </div>
    `,
    created() {
      // 获取 vscode API
      this.vscode = acquireVsCodeApi();
      if (!this.vscode) {
        console.error('Failed to acquire VSCode API.');
        return;
      }
      // 监听是否可见，如果不可见标识一下
      document.addEventListener('visibilitychange', this.onVisibility)
      // 接收 Webview 传来的消息
      window.addEventListener('message', this.onMessage);
    },
    methods: {
      // 终端运行
      disposeCommand() {
        this.vscode.postMessage({ type: 'execute-in-terminal' });
      },
      // 新开弹窗和当前弹窗运行
      runInCurrentTerminal(command, row) {
        const cmd = `npm run ${row.name}`;
        if (command === 'execute-with-new-session') {
          this.vscode.postMessage({ type: 'start-service', command: cmd });
        } else {
          this.vscode.postMessage({ type: 'execute-in-current', command: cmd });
        }
      },
      // 监听消息
      onMessage(event) {
        const { type, data } = event.data;
        if (type === 'vscode-params-channel') {
          this.$bus.$emit('global-data', { globalData: data });
          const scripts = data?.scripts || {};
          const services = data?.server || [];
          if (Object.keys(scripts).length) {
            // 填充指令表格数据
            this.tableData = Object.keys(scripts).reduce((prev, key, index) => {
              prev.push({
                index: index + 1,
                name: key,
                cmd: scripts[key],
              });
              return prev;
            }, []);
            this.status = `${JSON.stringify(this.tableData)}`;
            this.loading = false;
            this.$nextTick(() => {
              // 使用 GSAP 动画效果
              gsap.from('.el-table .el-table__body-wrapper .el-table__row', {
                opacity: 0,
                y: 50,
                duration: 0.6,
                stagger: 0.2,
                ease: 'back.out(1.7)',
              });
            });
          }
          this.serviceData = services || [];
        }
      },
      // 监听可见(卸载了不会触发)
      onVisibility() {
        if (document.visibilityState !== 'visible') {
          sessionStorage.setItem("WEBVIEW_VISIBILITY", false)
        }
      },
      // 运行命令的方法
      onRunCommand(row) {
        const cmd = `npm run ${row.name}`;
        // 向 VSCode 发送消息
        this.vscode.postMessage({ type: 'start-service', command: cmd });
      },
      // 创建服务
      showCreateServiceModal() {
        this.title = '创建服务';
        this.dialogVisible = true;
      },
      // 新建服务和修改服务
      handleConfirmService(data, type) {
        if (type === 'add') {
          this.vscode.postMessage({ type: 'new-service', data: data });
        } else {
          this.vscode.postMessage({ type: 'update-service', data: data });
        }
      },
      // 运行和停用
      toggleService(data) {
        data.active = !data.active;
        this.vscode.postMessage({ type: 'enable-service', data: data });
      },
      // 查看和编辑弹窗显示
      editService(data) {
        this.title = "查看服务";
        this.dialogVisible = true;
        this.currentRow = data;
      },
      deleteService(data) {
        this.vscode.postMessage({ type: 'delete-service', data: data });
      }
    },
  });
})();
