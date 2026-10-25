import type { Recipe } from './domain'

export const howToCookRepository='https://github.com/Anduin2017/HowToCook'
export function recipeOriginUrl(recipe:Recipe):string|null {
  if(recipe.origin?.provider==='howtocook')return howToCookRepository
  // Older imports and their private versions predate structured provenance.
  try {
    const url=new URL(recipe.source??'')
    return url.protocol==='https:'&&url.hostname==='github.com'&&/^\/Anduin2017\/HowToCook(?:\/|$)/i.test(url.pathname)?howToCookRepository:null
  } catch {return null}
}
export function coverIsReference(recipe:Recipe) {
  return !recipe.coverInfo||recipe.coverInfo.art!==recipe.art||recipe.coverInfo.kind!=='original'
}
