import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLayerGroup } from '@fortawesome/free-solid-svg-icons';
import { faVuejs, faNodeJs, faReact } from '@fortawesome/free-brands-svg-icons';
import styles from './index.module.css';

interface WelcomePageProps {
  onQuickOpen: (url: string) => void;
}

export default function WelcomePage(props: WelcomePageProps) {
  const { onQuickOpen } = props;

  return (
    <div className={styles['welcome-page']}>
      <FontAwesomeIcon icon={faLayerGroup} className={styles['welcome-icon']} />

      <h1 className={styles['welcome-title']}>Live Preview</h1>

      <p className={styles['welcome-subtitle']}>
        在上方地址栏输入您的本地开发服务器地址，或直接输入关键词进行搜索。
        <br />
        您也可以点击下方快捷选项快速填入：
      </p>

      <div className={styles['quick-links']}>
        <button className={styles['quick-link-btn']} onClick={() => onQuickOpen('localhost:5173')}>
          <FontAwesomeIcon icon={faVuejs} className={styles['brand-icon-vue']} />
          <span>Vite 默认端口 (5173)</span>
        </button>

        <button className={styles['quick-link-btn']} onClick={() => onQuickOpen('localhost:8080')}>
          <FontAwesomeIcon icon={faNodeJs} className={styles['brand-icon-node']} />
          <span>Vue CLI / Webpack (8080)</span>
        </button>

        <button className={styles['quick-link-btn']} onClick={() => onQuickOpen('localhost:3000')}>
          <FontAwesomeIcon icon={faReact} className={styles['brand-icon-react']} />
          <span>React / Next.js (3000)</span>
        </button>
      </div>
    </div>
  );
}