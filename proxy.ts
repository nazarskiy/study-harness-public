import { NextResponse, type NextRequest } from "next/server";
import { apiRequestRefusal } from "./src/server/web-access.ts";

export function proxy(request: NextRequest) {
	const refusal = apiRequestRefusal(request);
	if (refusal) {
		return NextResponse.json(
			{ error: refusal },
			{ status: 403, headers: { "Cache-Control": "no-store" } },
		);
	}
	return NextResponse.next();
}

export const config = {
	matcher: ["/api/:path*"],
};
