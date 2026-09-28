'use strict';

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function isYoutubeHost(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
    return host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be';
}

function parseYoutubeChatTarget(input) {
    const value = String(input || '').trim();
    if (!value) return null;
    if (VIDEO_ID_PATTERN.test(value)) return { liveId: value };
    if (value.startsWith('@') && /^@[A-Za-z0-9._-]+$/.test(value)) return { handle: value };

    let url;
    try {
        url = new URL(value);
    } catch (error) {
        return null;
    }
    if (!['http:', 'https:'].includes(url.protocol) || !isYoutubeHost(url.hostname)) return null;

    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const segments = url.pathname.split('/').filter(Boolean).map(segment => {
        try {
            return decodeURIComponent(segment);
        } catch (error) {
            return segment;
        }
    });
    const queryVideoId = url.searchParams.get('v');
    if (queryVideoId && VIDEO_ID_PATTERN.test(queryVideoId)) return { liveId: queryVideoId };
    if (host === 'youtu.be' && VIDEO_ID_PATTERN.test(segments[0] || '')) {
        return { liveId: segments[0] };
    }

    const videoMarker = segments.findIndex(segment => ['live', 'shorts', 'embed', 'v'].includes(segment.toLowerCase()));
    if (videoMarker >= 0 && VIDEO_ID_PATTERN.test(segments[videoMarker + 1] || '')) {
        return { liveId: segments[videoMarker + 1] };
    }

    const channelMarker = segments.findIndex(segment => ['channel', 'c', 'user'].includes(segment.toLowerCase()));
    if (channelMarker >= 0 && segments[channelMarker + 1]) {
        const id = segments[channelMarker + 1];
        if (segments[channelMarker].toLowerCase() === 'channel' && /^UC[A-Za-z0-9_-]+$/.test(id)) {
            return { channelId: id };
        }
        // Legacy /c/ and /user/ URLs are resolved to the active stream by yt-dlp.
        return null;
    }

    const handleSegment = segments.find(segment => segment.startsWith('@'));
    if (handleSegment && /^@[A-Za-z0-9._-]+$/.test(handleSegment)) return { handle: handleSegment };
    return null;
}

function youtubeChatMessageText(chatItem) {
    const message = Array.isArray(chatItem?.message) ? chatItem.message : [];
    return message.map(part => {
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.emojiText === 'string') return part.emojiText;
        return '';
    }).join('').trim();
}

module.exports = { parseYoutubeChatTarget, youtubeChatMessageText };
