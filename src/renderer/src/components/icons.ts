import { config } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faAnglesLeft,
  faMagnifyingGlass,
  faPen,
  faPenToSquare,
  faAnglesRight,
  faAsterisk,
  faBars,
  faBoxArchive,
  faChartSimple,
  faCheck,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faCopy,
  faEllipsis,
  faCircleInfo,
  faGear,
  faPlus,
  faRotateRight,
  faSliders,
  faWindowMaximize,
  faWindowMinimize,
  faWindowRestore,
  faXmark
} from '@fortawesome/free-solid-svg-icons'

/**
 * 全项目唯一的图标来源。
 *
 * 规则（AGENTS.md）：
 * - 不手写 SVG path，不拿 ▸ ✓ × ⋯ 这类字符当图标——字体不同机位会漂
 * - 需要新图标在这里登记，再从 `Icon.xxx` 取用，方便一次性审计/换主题
 * - 尺寸用字号控制（FA 的 svg 是 1em 见方），颜色用 currentColor 继承
 */
config.autoAddCss = false

export const Icon = {
  // 窗口控制
  minimize: faWindowMinimize,
  maximize: faWindowMaximize,
  restore: faWindowRestore,
  close: faXmark,
  // 导航与布局
  sidebarCollapse: faAnglesLeft,
  sidebarExpand: faBars,
  panelCollapse: faAnglesRight,
  panelExpand: faSliders,
  // 会话
  newChat: faPlus,
  sessionMenu: faEllipsis,
  archive: faBoxArchive,
  settings: faGear,
  // 消息
  assistant: faAsterisk,
  chevronLeft: faChevronLeft,
  chevronRight: faChevronRight,
  reasoningOpen: faChevronDown,
  reasoningClosed: faChevronRight,
  copy: faCopy,
  copied: faCheck,
  edit: faPen,
  markdownEditor: faPenToSquare,
  regenerate: faRotateRight,
  // 选择态
  check: faCheck,
  chevronDown: faChevronDown,
  // 用量
  usage: faChartSimple,
  // 搜索
  search: faMagnifyingGlass,
  searchClear: faXmark,
  // 说明性提示
  info: faCircleInfo
} as const

export { FontAwesomeIcon }
