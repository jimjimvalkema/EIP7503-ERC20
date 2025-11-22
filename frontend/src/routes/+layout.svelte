<script lang="ts">
  import "../app.css";
  import Toast from "$lib/components/Toast.svelte";
  import ErrorBoundary from "$lib/components/ErrorBoundary.svelte";
  let { children } = $props();
</script>

<ErrorBoundary>
  {@render children?.()}
</ErrorBoundary>

<Toast />
