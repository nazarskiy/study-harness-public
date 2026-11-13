
import { searchStatus } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(searchStatus());
}
