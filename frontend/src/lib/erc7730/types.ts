/**
 * ERC-7730 Types and Interfaces
 * Structured Data Clear Signing Format
 */

export interface ERC7730Descriptor {
	$schema?: string
	context?: Context
	metadata?: Metadata
	display?: Display
	includes?: string | string[]
}

export interface Context {
	$id?: string
	contract?: ContractContext
	eip712?: EIP712Context
}

export interface ContractContext {
	deployments?: Deployment[]
	abi?: unknown[]
	factory?: FactoryContext
}

export interface FactoryContext {
	deployEvent: string
	deployments: Deployment[]
}

export interface EIP712Context {
	schemas?: unknown[]
	domain?: Record<string, unknown>
	deployments?: Deployment[]
	domainSeparator?: string
}

export interface Deployment {
	chainId: number
	address: string
}

export interface Metadata {
	owner?: string
	contractName?: string
	info?: {
		url?: string
		deploymentDate?: string
	}
	token?: TokenMetadata
	constants?: Record<string, unknown>
	enums?: Record<string, Record<string, string>>
	maps?: Record<string, MetadataMap>
}

export interface TokenMetadata {
	name: string
	ticker: string
	decimals: number
}

export interface MetadataMap {
	keyPath: string
	values: Record<string, unknown>
}

export interface Display {
	definitions?: Record<string, FieldFormat>
	formats?: Record<string, StructuredDataFormat>
}

export interface StructuredDataFormat {
	$id?: string
	intent?: string | Record<string, string>
	interpolatedIntent?: string
	fields?: (FieldFormat | FieldReference | FieldGroup)[]
	required?: string[]
	excluded?: string[]
}

export interface FieldFormat {
	path?: string
	value?: unknown
	label?: string
	format?: string
	params?: Record<string, unknown>
	$id?: string
	visible?: string | VisibilityRule
	separator?: string
}

export interface FieldReference {
	path: string
	$ref: string
	params?: Record<string, unknown>
}

export interface FieldGroup {
	path?: string
	label?: string
	iteration?: 'sequential' | 'bundled'
	fields?: (FieldFormat | FieldReference | FieldGroup)[]
}

export interface VisibilityRule {
	ifNotIn?: unknown[]
	mustMatch?: unknown[]
}

// Format types
export type FormatType =
	| 'raw'
	| 'amount'
	| 'tokenAmount'
	| 'nftName'
	| 'date'
	| 'duration'
	| 'unit'
	| 'enum'
	| 'addressName'
	| 'tokenTicker'
	| 'calldata'

// Container values
export interface ContainerValues {
	from?: string
	to?: string
	value?: string
	chainId?: number
	data?: string
	selector?: string
}

// Formatted field result
export interface FormattedField {
	path: string
	label?: string
	value: string
	format: FormatType
	visible: 'always' | 'optional' | 'never'
}
