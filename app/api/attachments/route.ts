import { attachmentStore, AttachmentUploadError } from "@/src/server";
import { MAX_ATTACHMENT_BODY_BYTES } from "@/lib/attachment-limits.ts";
import { FormBodyLimitError, readBoundedFormData } from "@/lib/bounded-form-data.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
	try {
		const form = await readBoundedFormData(request, MAX_ATTACHMENT_BODY_BYTES, request.signal);
		const values = form.getAll("files");
		if ([...form.keys()].some(key => key !== "files") || values.some(value => !(value instanceof File))) {
			return Response.json({ error: "Invalid attachment upload." }, { status: 400 });
		}
		const attachments = await attachmentStore.save(values as File[], request.signal);
		return Response.json({ attachments }, { status: 201 });
	} catch (error) {
		if (error instanceof FormBodyLimitError) return Response.json({ error: "Attachments are too large. Select up to 25 MB at a time." }, { status: 413 });
		if (error instanceof AttachmentUploadError) return Response.json({ error: error.message }, { status: error.status });
		if (request.signal.aborted) return Response.json({ error: "Upload cancelled." }, { status: 499 });
		if (error instanceof SyntaxError || error instanceof TypeError) return Response.json({ error: "Could not read the upload. Select the files again." }, { status: 400 });
		return Response.json({ error: "Could not save the attachments. Try again." }, { status: 500 });
	}
}
