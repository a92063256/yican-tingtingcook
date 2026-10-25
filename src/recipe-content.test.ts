import { expect, it } from 'vitest'
import { recipes } from './seed'
import { coverIsReference, recipeOriginUrl } from './recipe-content'

it('keeps source attribution independent of editable source links and supports older imports',()=>{
  const recipe=recipes[0]
  expect(recipeOriginUrl(recipe)).toBeNull()
  expect(recipeOriginUrl({...recipe,source:'https://github.com/Anduin2017/HowToCook/blob/master/dishes/test.md'})).toBe('https://github.com/Anduin2017/HowToCook')
  expect(recipeOriginUrl({...recipe,source:'https://github.com/Anduin2017/HowToCookFake'})).toBeNull()
  expect(recipeOriginUrl({...recipe,source:'https://github.com.evil.test/Anduin2017/HowToCook'})).toBeNull()
  expect(recipeOriginUrl({...recipe,source:'https://example.com',origin:{provider:'howtocook',repository:'https://example.com',commit:'abc',path:'test.md'}})).toBe('https://github.com/Anduin2017/HowToCook')
})
it('only treats a verified original photo with matching artwork metadata as exact',()=>{
  const recipe=recipes[0]
  expect(coverIsReference(recipe)).toBe(true)
  const original={...recipe,art:'/images/original.webp',coverInfo:{art:'/images/original.webp',kind:'original' as const}}
  expect(coverIsReference(original)).toBe(false)
  expect(coverIsReference({...original,art:'/images/replaced.webp'})).toBe(true)
  for(const kind of ['substituted','generated','illustration','uncertain'] as const)expect(coverIsReference({...original,coverInfo:{...original.coverInfo,kind}})).toBe(true)
})
