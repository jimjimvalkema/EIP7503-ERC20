<script lang="ts" module>
  import type { ERC7730Descriptor } from "$lib/erc7730/types";

  export type ERC7730SignerProps = {
    descriptor?: ERC7730Descriptor | string;
    onSign?: (signature: string) => void;
  };
</script>

<script lang="ts">
  import {
    connectedAccount,
    currentProvider,
    signatureResult,
    signTypedData,
    createSampleTypedData,
  } from "$lib/providers";
  import Button from "$lib/components/ui/button/button.svelte";
  import * as Card from "$lib/components/ui/card";
  import Label from "$lib/components/ui/label/label.svelte";
  import * as Alert from "$lib/components/ui/alert";
  import { loadDescriptor, mergeIncludes } from "$lib/erc7730/descriptor";
  import {
    formatAllFields,
    processInterpolatedIntent,
  } from "$lib/erc7730/formatter";
  import type {
    ERC7730Descriptor as ERC7730DescriptorType,
    FieldFormat,
  } from "$lib/erc7730/types";

  let { descriptor, onSign }: ERC7730SignerProps = $props();

  let isLoading = $state(false);
  let error = $state<string | null>(null);
  let descriptorLoaded = $state<ERC7730DescriptorType | null>(null);
  let displayedFields = $state<Array<{ label?: string; value: string }>>([]);
  let displayedIntent = $state<string | null>(null);

  async function loadAndMergeDescriptor() {
    if (descriptor) {
      try {
        let desc =
          typeof descriptor === "string"
            ? await loadDescriptor(descriptor)
            : descriptor;
        if (desc) {
          desc = await mergeIncludes(desc);
          descriptorLoaded = desc;
          // Generate sample display
          generateSampleDisplay(desc);
        }
      } catch (err) {
        console.error("Failed to load descriptor:", err);
        error = "Failed to load ERC-7730 descriptor";
      }
    }
  }

  $effect(() => {
    loadAndMergeDescriptor();
  });

  function generateSampleDisplay(desc: ERC7730DescriptorType) {
    try {
      if (!$connectedAccount) return;

      // Get first format spec as example
      const formats = Object.entries(desc.display?.formats || {});
      if (formats.length === 0) return;

      const [, formatSpec] = formats[0];

      // Create sample structured data
      const sampleData: Record<string, unknown> = {};
      if (formatSpec.fields) {
        for (const field of formatSpec.fields) {
          if (typeof field === "object" && "path" in field && field.path) {
            sampleData[field.path] = "Sample Value";
          }
        }
      }

      // Format fields
      const container = {
        from: $connectedAccount,
        to: desc.context?.contract?.deployments?.[0]?.address,
        value: "-1",
        chainId: 1,
      };

      if (formatSpec.fields) {
        const formatted = formatAllFields(
          desc,
          container,
          sampleData,
          formatSpec.fields as FieldFormat[],
        );
        displayedFields = formatted.map((f) => ({
          label: f.label || f.path,
          value: f.value,
        }));
      }

      // Process interpolated intent if available
      if (formatSpec.interpolatedIntent && formatSpec.fields) {
        displayedIntent = processInterpolatedIntent(
          formatSpec.interpolatedIntent,
          desc,
          container,
          sampleData,
          formatSpec.fields as FieldFormat[],
        );
      } else if (typeof formatSpec.intent === "string") {
        displayedIntent = formatSpec.intent;
      }
    } catch (err) {
      console.error("Error generating sample display:", err);
    }
  }

  const handleSign = async () => {
    if (!$connectedAccount) {
      error = "No account connected";
      return;
    }

    if (!$currentProvider) {
      error = "No provider available";
      return;
    }

    if (!descriptorLoaded) {
      error = "No descriptor loaded";
      return;
    }

    isLoading = true;
    error = null;

    try {
      // Create sample typed data for signing
      const typedData = createSampleTypedData($connectedAccount);
      const signature = await signTypedData(
        typedData,
        $connectedAccount,
        $currentProvider,
      );
      onSign?.(signature);
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to sign";
    } finally {
      isLoading = false;
    }
  };

  const copySignature = () => {
    if ($signatureResult) {
      navigator.clipboard.writeText($signatureResult);
    }
  };
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Sign with ERC-7730</Card.Title>
    <Card.Description
      >Sign structured data with human-readable formatting</Card.Description
    >
  </Card.Header>
  <Card.Content>
    {#if !$connectedAccount}
      <Alert.Root>
        <Alert.Title>Wallet Not Connected</Alert.Title>
        <Alert.Description
          >Connect your wallet to sign with ERC-7730</Alert.Description
        >
      </Alert.Root>
    {:else if !descriptorLoaded}
      <Alert.Root>
        <Alert.Title>Descriptor Not Loaded</Alert.Title>
        <Alert.Description
          >Please provide an ERC-7730 descriptor to use this feature</Alert.Description
        >
      </Alert.Root>
    {:else}
      <div class="space-y-4">
        <!-- Intent Display -->
        {#if displayedIntent}
          <div
            class="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950"
          >
            <p class="text-sm font-semibold text-blue-900 dark:text-blue-100">
              Intent
            </p>
            <p class="mt-2 text-base text-blue-800 dark:text-blue-200">
              {displayedIntent}
            </p>
          </div>
        {/if}

        <!-- Formatted Fields -->
        {#if displayedFields.length > 0}
          <div class="space-y-3">
            <Label>Details</Label>
            {#each displayedFields as field (field.label)}
              <div
                class="flex items-start justify-between rounded-lg border border-border bg-card p-3"
              >
                <span class="text-sm font-medium text-foreground"
                  >{field.label}</span
                >
                <span class="font-mono text-xs text-muted-foreground"
                  >{field.value}</span
                >
              </div>
            {/each}
          </div>
        {/if}

        <!-- Descriptor Info -->
        {#if descriptorLoaded.metadata}
          <div class="space-y-2 rounded-lg border border-border bg-card p-3">
            {#if descriptorLoaded.metadata.contractName}
              <div class="flex justify-between text-sm">
                <span class="text-muted-foreground">Contract</span>
                <span class="font-medium"
                  >{descriptorLoaded.metadata.contractName}</span
                >
              </div>
            {/if}
            {#if descriptorLoaded.metadata.owner}
              <div class="flex justify-between text-sm">
                <span class="text-muted-foreground">Owner</span>
                <span class="font-medium"
                  >{descriptorLoaded.metadata.owner}</span
                >
              </div>
            {/if}
          </div>
        {/if}

        {#if error}
          <Alert.Root variant="destructive">
            <Alert.Title>Error</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Root>
        {/if}

        <Button onclick={handleSign} disabled={isLoading} class="w-full">
          {isLoading ? "Signing..." : "Sign Transaction"}
        </Button>

        {#if $signatureResult}
          <div
            class="space-y-2 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950"
          >
            <h4 class="font-semibold text-green-900 dark:text-green-100">
              Signature
            </h4>
            <div class="flex flex-col gap-2">
              <code
                class="block break-all rounded bg-background p-2 text-xs text-foreground overflow-y-auto max-h-24"
              >
                {$signatureResult}
              </code>
              <Button
                variant="outline"
                size="sm"
                onclick={copySignature}
                class="w-full"
              >
                Copy Signature
              </Button>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </Card.Content>
</Card.Root>
