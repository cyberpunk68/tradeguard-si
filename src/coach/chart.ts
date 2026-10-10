// Screenshot of the visible chart for the coach. Chrome only allows this after the trader has
// invoked TradeGuard SI on the tab (toolbar icon or shortcut, i.e. the activeTab grant), so failure
// is normal and silent: the coach falls back to page numbers and the sampled price structure.
const MAX_W = 1280;

export async function captureChart(windowId?: number): Promise<string | null> {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId ?? chrome.windows.WINDOW_ID_CURRENT, { format: 'jpeg', quality: 60 });
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const scale = Math.min(1, MAX_W / bmp.width);
    const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  } catch {
    return null;
  }
}
