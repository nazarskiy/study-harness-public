let photonModule = null;
let loadPromise = null;

export async function loadPhoton() {
    if (photonModule) return photonModule;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
        try {
            photonModule = await import("@silvia-odwyer/photon-node");
            return photonModule;
        } catch {
            photonModule = null;
            return photonModule;
        }
    })();
    return loadPromise;
}
