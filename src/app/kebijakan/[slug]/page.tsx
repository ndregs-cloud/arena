import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PolicyPage, POLICY_KEYS, type PolicyKey } from "@/components/commerce/policy-page";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const title = POLICY_KEYS[slug as PolicyKey];
  return { title: title ?? "Kebijakan", alternates: { canonical: `/kebijakan/${slug}` } };
}

export default async function PolicyRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(slug in POLICY_KEYS)) notFound();
  return <PolicyPage policyKey={slug as PolicyKey} />;
}
