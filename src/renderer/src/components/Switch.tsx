interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  /** 无障碍名称，同时可用于定位 */
  label: string
  disabled?: boolean
  title?: string
}

/**
 * 开关（docs/04 §4.5：32×18 胶囊，14px 拇指）。
 * 用 button + role="switch" 而不是 checkbox：样式完全自绘，
 * 同时保留键盘操作（Space / Enter）与屏幕阅读器语义。
 */
export function Switch({ checked, onChange, label, disabled = false, title }: Props): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border transition-colors disabled:opacity-40 ${
        checked ? 'border-accent bg-accent' : 'border-line bg-line'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-[15px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  )
}
