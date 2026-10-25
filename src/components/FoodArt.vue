<script setup lang="ts">
import { computed } from 'vue'
const props=defineProps<{ kind?: string; reference?:boolean; alt?:string }>()
const photo=computed(()=>props.kind?.startsWith('/images/'))
const label=computed(()=>(props.alt??(photo.value?'菜品封面':'菜品示意插画'))+(props.kind==='placeholder'?'，实拍待补充':'')+(props.reference?'，仅供参考':''))
const pieces = Array.from({length: 15}, (_, i) => ({x: 55 + ((i * 47) % 125), y: 53 + ((i * 31) % 95), r: (i * 61) % 180}))
</script>
<template>
  <span class="food-art" :class="{'food-photo':photo,'food-missing':kind==='placeholder'}" role="img" :aria-label="label" :data-cover-reference="reference||undefined">
    <img v-if="photo" :src="kind" alt="" loading="lazy" decoding="async">
    <svg v-else-if="kind==='placeholder'" class="food-placeholder" viewBox="0 0 240 200" aria-hidden="true">
      <circle cx="120" cy="82" r="47" fill="currentColor" opacity=".05"/>
      <circle cx="120" cy="82" r="34" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".25"/>
      <circle cx="120" cy="82" r="26" fill="none" stroke="currentColor" stroke-width="1" opacity=".12"/>
      <path d="M64 60v17q0 6 5 6t5-6V60M69 60v49M178 60q-9 8-9 23h9m0-23v49" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".4"/>
    </svg>
    <svg v-else viewBox="0 0 240 200" aria-hidden="true">
    <ellipse cx="123" cy="110" rx="91" ry="74" fill="#433829" opacity=".08"/>
    <ellipse cx="120" cy="98" rx="91" ry="76" fill="#fdfbf6"/>
    <ellipse cx="120" cy="98" rx="76" ry="62" fill="#e9e5d8"/>
    <ellipse cx="120" cy="98" rx="72" ry="58" :fill="kind==='soup' ? '#da8a54' : '#f3e4c7'"/>
    <template v-if="kind==='tomato' || kind==='soup'">
      <path v-for="(p,i) in pieces.slice(0,8)" :key="i" :d="`M ${p.x-10} ${p.y} Q ${p.x} ${p.y-21} ${p.x+19} ${p.y-3} L ${p.x+8} ${p.y+17} Q ${p.x-8} ${p.y+14} ${p.x-10} ${p.y}`" fill="#cc583b" stroke="#e5774e" stroke-width="3"/>
      <path v-for="(p,i) in pieces.slice(7)" :key="i+8" :d="`M ${p.x-9} ${p.y-7} Q ${p.x+3} ${p.y-13} ${p.x+19} ${p.y-6} L ${p.x+13} ${p.y+13} L ${p.x-11} ${p.y+9}Z`" :fill="kind==='soup'?'#f3e9cd':'#f0c754'" stroke="#f6d981" stroke-width="2"/>
    </template>
    <template v-else-if="kind==='shrimp'">
      <g v-for="(p,i) in pieces.slice(0,9)" :key="i" :transform="`translate(${p.x},${p.y}) rotate(${p.r})`"><path d="M 8 -12 C -17 -22 -23 17 1 16 C 15 16 18 2 10 -2" fill="none" stroke="#db8653" stroke-width="14" stroke-linecap="round"/><path d="M 6 -12 C -13 -15 -13 12 0 11" fill="none" stroke="#f5b582" stroke-width="7" stroke-linecap="round"/></g>
    </template>
    <template v-else-if="kind==='tofu'">
      <g v-for="(p,i) in pieces.slice(0,10)" :key="i" :transform="`translate(${p.x},${p.y}) rotate(${p.r/4})`"><rect x="-15" y="-13" width="32" height="26" rx="5" fill="#cd8c3e" stroke="#efd393" stroke-width="3"/><path d="M-8 -6L10 -6M-9 1L9 1" stroke="#dfad68" stroke-width="2"/></g>
    </template>
    <template v-else>
      <g v-for="(p,i) in pieces" :key="i" :transform="`translate(${p.x},${p.y}) rotate(${p.r})`">
        <template v-if="kind==='beef' && i%2===0"><path d="M-16 -9 Q-3 -19 15 -5 L12 10 Q-5 15 -17 6Z" fill="#976046" stroke="#bc8260" stroke-width="3"/></template>
        <template v-else><path d="M0 15L0 -6" stroke="#a4b067" stroke-width="7"/><ellipse cx="-7" cy="-5" rx="10" ry="14" fill="#71884b"/><ellipse cx="7" cy="-8" rx="11" ry="14" fill="#88984e"/><path d="M0 -14L0 3" stroke="#b8bc78" stroke-width="2"/></template>
      </g>
    </template>
    <path v-for="(p,i) in pieces.slice(2,11)" :key="`herb${i}`" :d="`M${p.x} ${p.y}l7 -3 -3 7Z`" fill="#607a48"/>
    <ellipse cx="79" cy="57" rx="21" ry="7" fill="#fff" opacity=".15" transform="rotate(-30 79 57)"/>
    </svg>
    <small v-if="kind==='placeholder'" class="food-placeholder-caption" aria-hidden="true">实拍待补充</small>
    <small v-if="reference" class="cover-reference" aria-hidden="true">仅供参考</small>
  </span>
</template>
<style scoped>
.food-placeholder{color:var(--muted,#8a8275);background:var(--surface,#faf7f0);padding-bottom:22px}
.food-missing{container-type:size;background:var(--paper,#faf7f0)}.food-placeholder-caption{position:absolute;left:6px;right:6px;bottom:33px;text-align:center;font-size:11px;line-height:1.5;letter-spacing:1px;color:var(--muted,#8a8275)}
@container (max-height:70px){.food-placeholder-caption{display:none}}
.food-art{position:relative;display:inline-block;vertical-align:middle;overflow:hidden;width:240px;height:200px;max-width:100%}.food-art>img,.food-art>svg{display:block;width:100%;height:100%}.food-art>img{object-fit:cover}.cover-reference{position:absolute;bottom:9px;left:9px;padding:3px 7px;border-radius:5px;background:rgba(35,32,27,.72);color:#fffaf3;font-size:10px;font-weight:400;letter-spacing:.4px;line-height:1.5;white-space:nowrap;pointer-events:none}
</style>
