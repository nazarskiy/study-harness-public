"use client";

import { buttonVariants } from "@/components/ui/button";

import { useEffect, useState } from "react";
import { CUSTOM_PROVIDER, MODEL_SLOTS, type AuthKeyStatus, type ModelCatalogResponse } from "@/src/core";
import { classifyKeys, type ProviderKeyInfo } from "@/components/settings/keys-section";
import { useModelCatalog } from "@/components/model-catalog";

export function hasProviderKey(
	statuses: readonly AuthKeyStatus[],
	providers: readonly ProviderKeyInfo[] | undefined,
): boolean {
	return (
		classifyKeys(statuses, providers).providerRows.some((s) => s.present) ||
		statuses.some((s) => s.id === CUSTOM_PROVIDER.envVar && s.present)
	);
}

export function savedSlotsConfigured(slots: ModelCatalogResponse["slots"] | undefined): boolean {
	return MODEL_SLOTS.every((slot) => !!slots?.[slot]?.model);
}

export function useModelSetup(initialConfigured: boolean) {
	const { catalog } = useModelCatalog();
	const [lastConfigured, setLastConfigured] = useState(initialConfigured);
	const configured = catalog ? savedSlotsConfigured(catalog.slots) : lastConfigured;
	useEffect(() => { if (catalog) setLastConfigured(savedSlotsConfigured(catalog.slots)); }, [catalog]);
	return { catalog, configured, zeroKeys: catalog ? !catalog.providers.some((p) => p.keyPresent) : false };
}

export function selectedModelUnavailable(catalog: ModelCatalogResponse | undefined, selected: string | undefined): boolean {
	return !!catalog && !!selected && !catalog.models.some((m) => `${m.provider}:${m.id}` === selected);
}

export function openModelPicker(): void {
	window.dispatchEvent(new CustomEvent("owlly:kbd-open-model-picker"));
}

export function useZeroKeys(): boolean {
	const { catalog } = useModelCatalog();
	return catalog ? !catalog.providers.some((provider) => provider.keyPresent) : false;
}

export function ZeroKeysPill({ onOpen, inline = false }: { onOpen: () => void; inline?: boolean }) {
	const button = (
		<button
			type="button"
			data-testid="setup-cta-keys"
			onClick={onOpen}
			className={buttonVariants({ variant: "secondary", size: "sm" })}
		>
			Add a provider key
		</button>
	);
	return inline ? button : <div className="pointer-events-auto mb-2 flex justify-center">{button}</div>;
}
export function strongKeyless(catalog: ModelCatalogResponse | undefined): boolean {
	const strong = catalog?.slots.strong;
	if (!strong) return false;
	return !catalog.providers.some((p) => p.id === strong.model.provider && p.keyPresent);
}

export function useStrongKeyless(): boolean {
	const { catalog } = useModelCatalog();
	return strongKeyless(catalog);
}
