import { FeaturePlaceholder } from "@/shared/components/FeaturePlaceholder";

export function ListingsScreen() {
  return (
    <FeaturePlaceholder
      eyebrow="ARCHIVIO IMMOBILIARE"
      title="I Suoi immobili."
      description="Un archivio unico per consultare, filtrare e aprire le schede degli immobili già registrati."
      icon="⌂"
      nextStep="Autenticazione Supabase e caricamento paginato degli annunci reali."
    />
  );
}
