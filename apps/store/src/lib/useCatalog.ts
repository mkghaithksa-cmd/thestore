import { fetchCategories, fetchProducts, fetchSettings } from './catalog'
import { useAsync } from './useAsync'

/** Products, categories and settings in one request batch. */
export function useCatalog() {
  return useAsync(async () => {
    const [products, categories, settings] = await Promise.all([
      fetchProducts(),
      fetchCategories(),
      fetchSettings(),
    ])
    return { products, categories, settings }
  })
}
