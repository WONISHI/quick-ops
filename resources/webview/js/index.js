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
      <div class="floating-menu">
        <!-- 两个小球 -->
        <div ref="menuBtn" class="ball" title="菜单">📂</div>
        <div ref="topBtn" class="ball" title="回到顶部">⬆️</div>

        <!-- 主按钮 -->
        <div ref="mainBtn" class="main-btn" @mouseenter="expand" @mouseleave="collapse">
          <!-- 收起时显示 -->
          <span ref="collapsedIcon" class="collapsed-icon">📂</span>
          <!-- 展开时显示 -->
          <div ref="expandedIcons" class="expanded-icons">
            <span title="指令">⚡</span>
            <span title="服务">🛠️</span>
            <span title="设置">⚙️</span>
          </div>
        </div>
      </div>
        `,
    methods: {
      expand() {
        const mainBtn = this.$refs.mainBtn;
        const menuBtn = this.$refs.menuBtn;
        const topBtn = this.$refs.topBtn;
        const collapsedIcon = this.$refs.collapsedIcon;
        const expandedIcons = this.$refs.expandedIcons;

        // 收起图标淡出，展开图标淡入
        gsap.set(collapsedIcon, { display: 'none', opacity: 0 });
        gsap.set(expandedIcons, { display: 'flex', opacity: 0 });

        gsap.to(expandedIcons, { opacity: 1, duration: 0.3 });

        // 矩形变圆
        gsap.to(mainBtn, {
          width: 40,
          height: 40,
          borderRadius: '50%',
          duration: 0.3,
          ease: 'power2.out',
        });

        // 展开两个小球
        gsap.to(menuBtn, { y: -70, opacity: 1, scale: 1, duration: 0.4 });
        gsap.to(topBtn, { y: 0, opacity: 1, scale: 1, duration: 0.4 });

        // 主按钮变椭圆
        gsap.to(mainBtn, {
          width: 140,
          height: 40,
          borderRadius: '30px',
          delay: 0.3,
          duration: 0.4,
          ease: 'power2.out',
        });
      },
      collapse() {
        const mainBtn = this.$refs.mainBtn;
        const menuBtn = this.$refs.menuBtn;
        const topBtn = this.$refs.topBtn;
        const collapsedIcon = this.$refs.collapsedIcon;
        const expandedIcons = this.$refs.expandedIcons;

        // 隐藏 expanded，显示 collapsed
        gsap.to(expandedIcons, {
          opacity: 0,
          duration: 0.2,
          onComplete: () => {
            gsap.set(expandedIcons, { display: 'none' });
            gsap.set(collapsedIcon, { display: 'inline-block', opacity: 1 });
          },
        });
        gsap.to(collapsedIcon, { opacity: 1, delay: 0.2, duration: 0.3 });

        // 收回两个小球
        gsap.to([menuBtn, topBtn], { y: 0, opacity: 0, scale: 0, duration: 0.3 });

        // 主按钮恢复矩形
        gsap.to(mainBtn, {
          width: 40,
          height: 40,
          borderRadius: 8,
          duration: 0.4,
          ease: 'power2.inOut',
        });
      },
    },
    mounted() {
      // 初始状态
      gsap.set(this.$refs.mainBtn, { width: 50, height: 30, borderRadius: 8 });
      gsap.set([this.$refs.menuBtn, this.$refs.topBtn], { opacity: 0, scale: 0 });
      gsap.set(this.$refs.expandedIcons, { opacity: 0 });
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
      loading: true,
      tableData: [],
      status: 1,
      scripts: null,
    },
    template: `
          <div class="webview-menu">
            <webview-menu :catalogue="useCatalogue"></webview-menu>
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
        this.status = 2;
        const { type, data } = event.data;
        if (['ready', 'update'].includes(type)) {
          const scripts = data?.scripts || {};
          this.scripts = scripts;
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
  console.log('form', form);
}
