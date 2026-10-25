<script setup lang="ts">
import { people, type State } from '../domain'
import type { MealReview } from '../reviews'
defineProps<{ reviews: MealReview[]; state: State; person: string }>()
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { month:'long', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false })
</script>
<template>
  <div class="review-feed">
    <article v-for="review in reviews" :key="review.id" class="review-note">
      <header><span class="avatar small" :style="{background:people[review.userId]?.color}">{{people[review.userId]?.short||'客'}}</span><div><b>{{people[review.userId]?.name||'家人'}}<small v-if="review.userId===person"> · 我</small></b><time :datetime="review.updatedAt">{{date(review.updatedAt)}}{{review.createdAt!==review.updatedAt?' · 已编辑':''}}</time></div><span class="review-kind">{{review.recipeId?'这道菜':'整餐'}}</span></header>
      <span v-if="review.recipeId" class="review-dish-name">{{state.recipes.find(r=>r.id===review.recipeId)?.name||'这道菜'}}</span>
      <p>{{review.text}}</p>
    </article>
  </div>
</template>
