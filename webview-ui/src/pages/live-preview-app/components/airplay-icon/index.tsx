/**
 * @description AirPlay 设备投放图标
 *
 * Font Awesome Free 中没有 `faAirplay`，
 * 使用内联 SVG，颜色自动继承按钮的 currentColor。
 */
export default function AirPlayIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M8 17H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />

      <path d="m12 15 4 5H8l4-5Z" fill="currentColor" />
    </svg>
  );
}