import type { AsyncState } from '../lib/useAsync'

/** Loading / error placeholder for catalog pages. Renders nothing on success. */
export function CatalogStatus<T>({ state, reload }: { state: AsyncState<T>; reload: () => void }) {
  if (state.status === 'loading') {
    return (
      <div className="grid" aria-busy="true" aria-label="جاري التحميل">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="prod skeleton" />
        ))}
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="notice bad" role="alert">
        <b>تعذر تحميل المنتجات.</b>
        <span className="muted">{state.error.message}</span>
        <button className="btn sm" onClick={reload}>
          إعادة المحاولة
        </button>
      </div>
    )
  }
  return null
}
