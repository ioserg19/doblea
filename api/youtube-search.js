// Vercel Serverless Function: api/youtube-search.js
// Estrategia híbrida: Intenta YouTube Data API v3 oficial; si la clave está restringida/inactiva, recurre a scraping de respaldo

const YOUTUBE_API_KEY = 'AIzaSyAXQ_fy_Fpci066gRIQzBG6BJcxF2eAVE0';

async function fallbackScrape(q) {
    try {
        const ytRes = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
            }
        });

        if (!ytRes.ok) return [];

        const html = await ytRes.text();
        const jsonMatch = html.match(/var ytInitialData = ({.*?});<\/script>/);
        if (!jsonMatch) return [];

        const data = JSON.parse(jsonMatch[1]);
        const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
        const results = [];

        for (const section of contents) {
            const items = section.itemSectionRenderer?.contents || [];
            for (const item of items) {
                const vr = item.videoRenderer;
                if (vr && vr.videoId) {
                    const videoId = vr.videoId;
                    const title = vr.title?.runs?.[0]?.text || 'Video de YouTube';
                    const channel = vr.ownerText?.runs?.[0]?.text || '';
                    const duration = vr.lengthText?.simpleText || '';
                    const thumbnail = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

                    results.push({
                        id: videoId,
                        url: `https://www.youtube.com/watch?v=${videoId}`,
                        title: title,
                        channel: channel,
                        duration: duration,
                        thumbnail: thumbnail
                    });

                    if (results.length >= 8) break;
                }
            }
            if (results.length >= 8) break;
        }
        return results;
    } catch (e) {
        return [];
    }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const q = (req.query && req.query.q) ? req.query.q.trim() : '';

    if (!q) {
        return res.status(200).json({ items: [] });
    }

    // 1. Intentar con YouTube Data API v3 oficial
    try {
        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&key=${YOUTUBE_API_KEY}&maxResults=8&type=video&relevanceLanguage=es`;
        const searchRes = await fetch(searchUrl);

        if (searchRes.ok) {
            const data = await searchRes.json();
            if (data.items && data.items.length > 0) {
                const videoIds = data.items.map(item => item.id.videoId).join(',');
                let durations = {};
                try {
                    const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds}&key=${YOUTUBE_API_KEY}`;
                    const detailsRes = await fetch(detailsUrl);
                    if (detailsRes.ok) {
                        const detailsData = await detailsRes.json();
                        (detailsData.items || []).forEach(item => {
                            const dur = item.contentDetails.duration;
                            const match = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
                            if (match) {
                                const h = match[1] ? match[1] + ':' : '';
                                const m = match[2] || '0';
                                const s = (match[3] || '0').padStart(2, '0');
                                durations[item.id] = `${h}${m}:${s}`;
                            }
                        });
                    }
                } catch (e) {}

                const results = data.items.map(item => ({
                    id: item.id.videoId,
                    url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
                    title: item.snippet.title,
                    channel: item.snippet.channelTitle,
                    duration: durations[item.id.videoId] || '',
                    thumbnail: (item.snippet.thumbnails.medium || item.snippet.thumbnails.default || {}).url
                               || `https://img.youtube.com/vi/${item.id.videoId}/mqdefault.jpg`
                }));

                return res.status(200).json({ items: results, source: 'api' });
            }
        }
    } catch (err) {
        console.warn('Fallo YouTube API v3, recurriendo a fallback:', err.message);
    }

    // 2. Fallback de rescate si la API da 403 o falla
    const fallbackResults = await fallbackScrape(q);
    return res.status(200).json({ items: fallbackResults, source: 'fallback' });
};
