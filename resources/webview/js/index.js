(function () {
  // 全局注册 Element UI
  Vue.use(ELEMENT);

  // 定义组件（可以写 template）
  Vue.component('webview-menu', {
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

  // 创建弹窗
  Vue.component("create-http", {
    props: ['dialogVisible'],
    data() {
      return {
        statusCode: [100, 101, 102, 200, 201, 202, 204, 301, 302, 304, 400, 401, 403, 404, 409, 429, 500, 501, 502, 503, 504],
        mockCategories: {
          Basic: ['boolean', 'natural', 'integer', 'float', 'character', 'string', 'range'],
          Date: ['date', 'time', 'datetime', 'now'],
          Image: ['img', 'dataImage'],
          Color: ['color', 'hex', 'rgb', 'rgba', 'hsl'],
          Text: [
            'paragraph',
            'sentence',
            'word',
            'title',
            'cparagraph',
            'csentence',
            'cword',
            'ctitle'
          ],
          Name: ['first', 'last', 'name', 'cfirst', 'clast', 'cname'],
          Web: ['url', 'domain', 'protocol', 'tld', 'email', 'ip'],
          Address: ['region', 'province', 'city', 'county', 'zip'],
          Helper: ['capitalize', 'upper', 'lower', 'pick', 'shuffle'],
          Miscellaneous: ['guid', 'id', 'increment']
        },
        httpTemplate: {
          code: 200,
          status: true,
          data: null
        }
      }
    },
    template: `
      <el-dialog
        title="创建服务"
        :visible.sync="dialogVisible"
        width="50%"
        :before-close="handleClose">
        <el-form ref="form" :model="httpTemplate" label-width="80px">
          <el-form-item label="状态码">
            <el-select v-model="httpTemplate.code" placeholder="请选择活动区域">
              <el-option :label="item" :value="item" v-for="(item,index) in statusCode" :key="index"></el-option>
            </el-select>
          </el-form-item>
          <el-form-item label="是否成功">
            <el-radio-group v-model="httpTemplate.status">
              <el-radio :label="true">是</el-radio>
              <el-radio :label="false">否</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="数据结构">
            
          </el-form-item>
        </el-form>
        <span slot="footer" class="dialog-footer">
          <el-button @click="handleClose">取 消</el-button>
          <el-button type="primary" @click="handleClose">确 定</el-button>
        </span>
      </el-dialog>
    `,
    mounted() {

    },
    methods: {
      handleClose() {
        this.$emit("update:dialogVisible", false)
      }
    }
  })

  // 根实例
  new Vue({
    el: '#app',
    data: {
      useCatalogue: [
        { label: '指令', value: 'shell' },
        { label: '服务', value: 'service' },
        { label: '设置', value: 'settings' },
      ],
      activeName: "shell",
      loading: true,
      activeName: 'shell',
      vscode: null,
      dialogVisible: false,
      tableData: [],
    },
    template: `
      <div class="webview-menu" v-loading="loading">
        <!-- 使用v-model进行绑定 -->
        <webview-menu :value="activeName" @input="activeName = $event" :catalogue="useCatalogue">
          <template #shell>
            <!-- shell 选项卡的内容 -->
            <div v-show="activeName === 'shell'">
              <el-table :data="tableData" style="width: 100%">
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
                    <el-button @click="handleClick(scope.row)" type="text" size="small">{{scope.row.cmd}}</el-button>
                  </template>
                </el-table-column>
                <el-table-column
                  label="操作"
                  min-width="20%">
                  <template slot-scope="scope">
                    <el-button @click="handleClick(scope.row)" type="text" size="small">运行</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </template>
          <template #service>
            <div class="service-view">
              <div class="service-operate">
                <el-button @click="handleCreateService">创建服务</el-button>
              </div>
              <create-http :dialogVisible="dialogVisible"></create-http>
            </div>
          </template>
        </webview-menu>
      </div>
    `,
    mounted() {
      // 获取 vscode API
      this.vscode = acquireVsCodeApi();
      if (!this.vscode) {
        console.error("Failed to acquire VSCode API.");
        return;
      }

      // 接收 Webview 传来的消息
      window.addEventListener('message', (event) => {
        const { type, data } = event.data;
        if (['ready', 'update'].includes(type)) {
          const scripts = data?.scripts || {};
          if (Object.keys(scripts).length) {
            // 填充表格数据
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
        }
      });
    },
    methods: {
      // 运行命令的方法
      handleClick(row) {
        const cmd = `npm run ${row.name}`;
        // 向 VSCode 发送消息
        this.vscode.postMessage({ type: 'run', command: cmd });
      },
      // 创建服务
      handleCreateService() {
        this.dialogVisible = true
      }
    },
  });
})();

function createMockSelect() {
  const mockFormat = [
    {
      label: '基本',
      value: 'basic',
      type: 'select',
      options: [
        { label: '布尔值', value: 'boolean', type: 'input' },
        { label: '自然数', value: 'natural', type: 'input' },
        { label: '整数', value: 'integer', type: 'input' },
        { label: '浮点数', value: 'float', type: 'input' },
        { label: '字符', value: 'character', type: 'input' },
        { label: '字符串', value: 'string', type: 'input' },
        { label: '范围', value: 'range', type: 'input' },
      ],
    },
  ];
  const form = new BasicComponents(data);
}