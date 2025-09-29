(function () {
  const vscode = acquireVsCodeApi();

  // 全局注册 Element UI
  Vue.use(ELEMENT);

  // 定义组件（可以写 template）
  Vue.component('webview-menu', {
    props: ['catalogue'],
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
            </el-tab-pane>
          </el-tabs>
        `,
    methods: {
      handleClick(tab) {
        console.log('点击了：', tab.name);
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
      activeName:"shell",
      loading: true,
      tableData: [],
    },
    template: `
          <div class="webview-menu">
            <webview-menu v-model="activeName" :catalogue="useCatalogue"></webview-menu>
            {{this.tableData}}
            <div>
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
          </div>
        `,
    mounted() {
      window.addEventListener('message', (event) => {
        const { type, data } = event.data;
        if (['ready', 'update'].includes(type)) {
          const scripts = data?.scripts || {};
          if (Object.keys(scripts).length) {
            this.tableData = Object.keys(scripts).reduce((prev, key, index) => {
              prev.push({
                index: index + 1,
                name: key,
                cmd: scripts[key],
              });
              return prev;
            }, []);
            this.loading = false;
            this.$nextTick(() => {
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
      handleClick(row) {
        const cmd = `npm run ${row.name}`;
        vscode.postMessage({ type: 'run', command: cmd });
      },
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