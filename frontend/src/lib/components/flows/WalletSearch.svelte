<script lang="ts">
  import { Input } from "$lib/components/ui/input";
  import { Button } from "$lib/components/ui/button";
  import SkeletonCard from "$lib/components/SkeletonCard.svelte";
  import {
    resolveWalletAddress,
    formatAddressForDisplay,
  } from "$lib/utils/wallet";
  import { hasMetakey } from "$lib/utils/metakey";
  import { ensCache } from "$lib/store/ensCache";
  import type { Address } from "viem";
  import { AlertCircle, CheckCircle2, Search } from "@lucide/svelte";

  interface Props {
    onSelect?: (address: Address, ensName: string, hasKey: boolean) => void;
    loading?: boolean;
  }

  let { onSelect, loading = false }: Props = $props();

  let searchInput = $state("");
  let resolvedAddress: Address | null = $state(null);
  let displayName: string | null = $state(null);
  let metakeyExists = $state<boolean | null>(null);
  let error: string | null = $state(null);
  let searching = $state(false);

  async function handleSearch() {
    if (!searchInput.trim()) {
      error = "Please enter a wallet address or ENS name";
      return;
    }

    searching = true;
    error = null;
    resolvedAddress = null;
    metakeyExists = null;

    try {
      // Resolve the address
      const resolved = await resolveWalletAddress(searchInput.trim());

      if (!resolved) {
        error = "Could not resolve wallet address. Please check the input.";
        searching = false;
        return;
      }

      resolvedAddress = resolved;
      displayName = await formatAddressForDisplay(resolved, true);
      
      // Cache the ENS name
      ensCache.set(resolved, displayName !== resolved ? displayName : null);

      // Check for metakey
      metakeyExists = await hasMetakey(searchInput.trim());
    } catch (err) {
      error = `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
    } finally {
      searching = false;
    }
  }

  function handleSelect() {
    if (resolvedAddress && metakeyExists !== null) {
      onSelect?.(resolvedAddress, searchInput, metakeyExists);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      handleSearch();
    }
  }
</script>

<div class="w-full space-y-4">
  <div class="space-y-2">
    <label for="wallet-search" class="text-sm font-medium text-foreground">
      Wallet Address or ENS Name
    </label>
    <div class="flex gap-2">
      <Input
        id="wallet-search"
        bind:value={searchInput}
        onkeydown={handleKeydown}
        disabled={searching || loading}
        placeholder="0x123... or vitalik.eth"
        class="flex-1"
      />
      <Button
        onclick={handleSearch}
        disabled={searching || loading}
        class="gap-2"
      >
        <Search size={16} />
        {searching ? "Searching..." : "Search"}
      </Button>
    </div>
  </div>

  {#if error}
    <div
      class="p-3 bg-destructive/10 border border-destructive rounded-md flex gap-2"
    >
      <AlertCircle size={16} class="text-destructive flex-shrink-0 mt-0.5" />
      <p class="text-sm text-destructive">{error}</p>
    </div>
  {/if}

  {#if searching}
    <SkeletonCard />
  {:else if resolvedAddress}
    <div class="space-y-3 p-4 bg-card border border-border rounded-md">
      <div>
        <p class="text-xs text-muted-foreground mb-1">Resolved Address</p>
        <p class="font-mono text-sm">{resolvedAddress} ({displayName})</p>
      </div>

      <div class="flex items-center gap-2">
        {#if searching}
          <div class="flex items-center gap-2 w-full">
            <div
              class="animate-spin rounded-full h-4 w-4 border border-primary border-t-transparent"
            ></div>
            <p class="text-sm text-muted-foreground">Checking for MetaKey...</p>
          </div>
        {:else if metakeyExists === true}
          <CheckCircle2 size={20} class="text-green-500" />
          <div>
            <p class="font-medium text-sm">MetaKey Found</p>
            <p class="text-xs text-muted-foreground">
              This address has a valid MetaKey
            </p>
          </div>
        {:else if metakeyExists === false}
          <AlertCircle size={20} class="text-yellow-500" />
          <div>
            <p class="font-medium text-sm">No MetaKey Found</p>
            <p class="text-xs text-muted-foreground">
              This address does not have a MetaKey
            </p>
          </div>
        {/if}
      </div>

      {#if searching}
        <div
          class="p-3 bg-blue-500/10 border border-blue-500/20 rounded text-sm text-blue-700"
        >
          Searching and verifying MetaKey...
        </div>
      {:else if metakeyExists === true}
        <Button onclick={handleSelect} disabled={loading} class="w-full">
          {loading ? "Processing..." : "Continue"}
        </Button>
      {:else if metakeyExists === false}
        <div
          class="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded text-sm text-yellow-700"
        >
          Cannot send to this address without a MetaKey.
        </div>
      {/if}
    </div>
  {/if}
</div>
