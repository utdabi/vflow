// ConfirmModal.tsx
// Reusable branded confirmation dialog — replaces browser-native confirm() / alert().
// Matches the existing app modal style (rounded-2xl, shadow-2xl, bg-black/40 backdrop).

interface ConfirmModalProps {
  title: string
  message: string
  confirmLabel?: string
  variant?: 'danger' | 'primary'
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  variant = 'primary',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const confirmCls = variant === 'danger'
    ? 'px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors'
    : 'px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors'

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="px-6 pt-6 pb-2">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <p className="text-sm text-gray-600 mt-1">{message}</p>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button onClick={onConfirm} className={confirmCls}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
