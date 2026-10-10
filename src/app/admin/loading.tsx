import { SkeletonList } from "@/components/ui/state";

export default function AdminLoading() {
  return (
    <div aria-busy="true">
      <p className="sr-only">Memuat data admin…</p>
      <SkeletonList count={4} height="h-28" />
    </div>
  );
}
