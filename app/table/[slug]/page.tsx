import TableRoom from "@/components/table-room";

export default function TablePage({ params }: { params: { slug: string } }) {
  return <TableRoom slug={params.slug} />;
}
