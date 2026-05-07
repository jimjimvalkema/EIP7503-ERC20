import type { FeeData } from "./types.ts"

export interface ProfitabilityResult {
    profitable: boolean
    gasCostInTokens: bigint
    relayerPayout: bigint
    refundToSender: bigint
}

export function isFeeDataProfitable(feeData: FeeData, decimalsTokenPrice: number, baseFeePerGas = 0n, minProfitMarginPercent = 0): ProfitabilityResult {
    const feeInWei = BigInt(feeData.estimatedGasCost) * (baseFeePerGas + BigInt(feeData.estimatedPriorityFee))
    const gasCostInTokens = feeInWei * BigInt(feeData.tokensPerEthPrice) / (10n ** BigInt(decimalsTokenPrice))
    const relayerPayout = gasCostInTokens + BigInt(feeData.relayerBonus)
    const maxFee = BigInt(feeData.maxFee)
    const refundToSender = maxFee - relayerPayout
    return {
        profitable: relayerPayout * (100n + BigInt(minProfitMarginPercent)) / 100n <= maxFee,
        gasCostInTokens,
        relayerPayout,
        refundToSender,
    }
}
