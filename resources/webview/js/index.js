(function () {
  const vscode = acquireVsCodeApi();
  const useCatalogue = [
    { label: '指令', value: 'shell' },
    { label: '服务', value: 'service' },
    { label: '设置', value: 'settings' },
  ];

  document.querySelector('.webview-title-text').innerText = useCatalogue[0].label;

  // 构造表格
  function buildTable(scripts) {
    const headers = ['序号', '指令名称', '指令', '操作'].map((t) => `<th>${t}</th>`).join('');

    const rows = Object.keys(scripts)
      .map((key, i) => {
        return `
          <tr>
            <td align="center">${i + 1}</td>
            <td align="center">${key}</td>
            <td align="center" class="table-shell-code">
              <span>${scripts[key]}</span>
            </td>
            <td align="center">
              <button data-cmd="npm run ${key}" class="run-code">运行</button>
            </td>
          </tr>`;
      })
      .join('');

    return `
      <table class="table-shell">
        <thead class="table-shell-thead"><tr>${headers}</tr></thead>
        <tbody class="table-shell-tbody">${rows}</tbody>
      </table>`;
  }

  // 绑定按钮事件
  function bindRunEvents() {
    document.querySelectorAll('.run-code').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cmd = btn.getAttribute('data-cmd');
        vscode.postMessage({ type: 'run', command: cmd });
      });
    });
  }

  // 接收插件发来的消息
  window.addEventListener('message', (event) => {
    const { type, data } = event.data;
    if (['ready', 'update'].includes(type)) {
      const container = document.querySelector('.webview-shell');
      const scripts = data?.scripts || {};
      if (Object.keys(scripts).length) {
        container.style.display = 'block';
        const html = buildTable(scripts);
        container.innerHTML = html;
        bindRunEvents(); // 表格生成后再绑定事件
      } else {
        container.style.display = 'none';
      }
    }
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

class BasicComponents {
  constructor(data, fields = { label: 'label', value: 'value' }) {
    this.data = this.getTemplates(data);
    this.fields = fields;
    this.structure = {
      input: this.createInput.bind(this),
      textarea: this.createTextarea.bind(this),
      select: this.createSelect.bind(this),
      checkbox: this.createCheckbox.bind(this),
      radio: this.createRadio.bind(this),
    };
    this.formValues = {}; // 存储值
    this.errors = {}; // 存储错误信息
  }
  getTemplates(data) {
    if (typeof data !== 'object') return [];
    return Array.isArray(data) ? data : [data];
  }
  render(container) {
    this.container = container;
    this.container.innerHTML = '';
    this.data.forEach((item) => {
      const fieldEl = this.createField(item);
      if (fieldEl) {
        this.container.appendChild(fieldEl);
      }
    });
  }
  createField(item) {
    const type = item.type;
    const factory = this.structure[type];
    if (!factory) return null;
    // 判断是否可见
    let isVisible = this.getVisibility(item);
    const wrapper = document.createElement('div');
    wrapper.className = 'form-item';
    wrapper.style.display = isVisible ? '' : 'none';
    const label = document.createElement('label');
    label.textContent = item[this.fields.label] || '';
    wrapper.appendChild(label);
    const field = factory(item);
    wrapper.appendChild(field);
    // 错误提示
    const errorMsg = document.createElement('div');
    errorMsg.className = 'error-msg';
    errorMsg.style.color = 'red';
    wrapper.appendChild(errorMsg);
    // 保存默认值
    this.formValues[item[this.fields.value]] = item.default || '';
    return wrapper;
  }
  getVisibility(item) {
    if (typeof item.visible === 'function') {
      return item.visible(this.formValues);
    } else if (typeof item.visible === 'boolean') {
      return item.visible;
    }
    return true;
  }
  createInput(item) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = item.default || '';
    input.oninput = (e) => {
      this.formValues[item[this.fields.value]] = e.target.value;
      this.updateVisibility();
    };
    return input;
  }
  createTextarea(item) {
    const textarea = document.createElement('textarea');
    textarea.value = item.default || '';
    textarea.oninput = (e) => {
      this.formValues[item[this.fields.value]] = e.target.value;
      this.updateVisibility();
    };
    return textarea;
  }
  createSelect(item) {
    const select = document.createElement('select');
    (item.options || []).forEach((opt) => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      select.appendChild(option);
    });
    select.value = item.default || '';
    select.onchange = (e) => {
      this.formValues[item[this.fields.value]] = e.target.value;
      this.updateVisibility();
    };
    return select;
  }
  createCheckbox(item) {
    const container = document.createElement('div');
    (item.options || []).forEach((opt) => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = opt.value;
      checkbox.checked = (item.default || []).includes(opt.value);
      checkbox.onchange = () => {
        this.formValues[item[this.fields.value]] = Array.from(container.querySelectorAll('input:checked')).map((c) => c.value);
        this.updateVisibility();
      };
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(opt.label));
      container.appendChild(label);
    });
    this.formValues[item[this.fields.value]] = item.default || [];
    return container;
  }
  createRadio(item) {
    const container = document.createElement('div');
    (item.options || []).forEach((opt) => {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = item[this.fields.value];
      radio.value = opt.value;
      radio.checked = item.default === opt.value;
      radio.onchange = () => {
        this.formValues[item[this.fields.value]] = radio.value;
        this.updateVisibility();
      };
      label.appendChild(radio);
      label.appendChild(document.createTextNode(opt.label));
      container.appendChild(label);
    });
    this.formValues[item[this.fields.value]] = item.default || '';
    return container;
  }
  updateVisibility() {
    if (!this.container) return;
    Array.from(this.container.children).forEach((child, index) => {
      const item = this.data[index];
      let isVisible = this.getVisibility(item);
      child.style.display = isVisible ? '' : 'none';
    });
  }
  validate() {
    this.errors = {};
    Array.from(this.container.children).forEach((child, index) => {
      const item = this.data[index];
      const key = item[this.fields.value];
      const value = this.formValues[key];
      let error = '';

      if (item.required && !value) {
        error = item.label + '不能为空';
      } else if (typeof item.validator === 'function') {
        const result = item.validator(value, this.formValues);
        if (result !== true) {
          error = result || '格式不正确';
        }
      }
      this.errors[key] = error;
      const errorDiv = child.querySelector('.error-msg');
      if (errorDiv) {
        errorDiv.textContent = error;
      }
    });
    return Object.values(this.errors).every((e) => !e);
  }
  getValues() {
    return this.formValues;
  }
}
