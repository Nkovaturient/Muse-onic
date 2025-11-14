const { createLogger } = require('../utils/logger');
const { getConfig } = require('../utils/config');
const { triggerLyricsSearch } = require('../../n8n/workflowHooks');
const { spawn } = require('child_process');
const https = require('https');

const logger = createLogger('search');

async function searchViaN8n(query) {
  const config = getConfig();
  if (!config.n8nEnabled) return null;

  try {
    const response = await triggerLyricsSearch({ query });
    if (!response) return null;

    if (response.best && response.matches) {
      return response;
    }

    if (response.url) {
      return {
        query,
        matches: [
          {
            title: response.title || query,
            url: response.url,
            snippet: response.snippet || ''
          }
        ],
        best: {
          title: response.title || query,
          url: response.url,
          snippet: response.snippet || ''
        }
      };
    }

    return null;
  } catch (error) {
    logger.warn('n8n lyrics search failed, falling back', error.message || error);
    return null;
  }
}

async function searchYouTubeDirect(query, limit = 5) {
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    
    return new Promise((resolve) => {
      const options = {
        hostname: 'www.youtube.com',
        path: `/results?search_query=${encodeURIComponent(query)}`,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: 8000
      };
      
      const req = https.request(options, (res) => {
        let html = '';
        
        res.on('data', (chunk) => {
          html += chunk.toString();
        });
        
        res.on('end', () => {
          try {
            const results = [];
            
            // Extract video data from YouTube's initial data JSON
            // YouTube embeds video data in a script tag with var ytInitialData
            const ytInitialDataMatch = html.match(/var ytInitialData = ({.+?});/);
            
            if (ytInitialDataMatch) {
              try {
                const data = JSON.parse(ytInitialDataMatch[1]);
                const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];
                
                for (const item of contents) {
                  if (results.length >= limit) break;
                  
                  const videoRenderer = item?.videoRenderer;
                  if (videoRenderer) {
                    const videoId = videoRenderer.videoId;
                    const title = videoRenderer.title?.runs?.[0]?.text || videoRenderer.title?.simpleText || 'Unknown';
                    const snippet = videoRenderer.descriptionSnippet?.runs?.map(r => r.text).join('') || videoRenderer.descriptionSnippet?.simpleText || '';
                    const duration = videoRenderer.lengthText?.simpleText || '';
                    
                    if (videoId) {
                      results.push({
                        title: title,
                        url: `https://www.youtube.com/watch?v=${videoId}`,
                        snippet: snippet || duration,
                        videoId: videoId,
                        duration: duration
                      });
                    }
                  }
                }
              } catch (parseError) {
                logger.debug('Failed to parse YouTube initial data', parseError.message);
              }
            }
            
            // Fallback: Try to extract video IDs from watch links in HTML
            if (results.length === 0) {
              const watchPattern = /watch\?v=([a-zA-Z0-9_-]{11})/g;
              const titlePattern = /"title":\s*\{[^}]*"text":\s*"([^"]+)"/g;
              let match;
              const videoIds = new Set();
              
              while ((match = watchPattern.exec(html)) !== null && videoIds.size < limit) {
                const videoId = match[1];
                if (!videoIds.has(videoId)) {
                  videoIds.add(videoId);
                  results.push({
                    title: `${query} - Video`,
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    snippet: '',
                    videoId: videoId
                  });
                }
              }
            }
            
            resolve(results);
          } catch (parseError) {
            logger.debug('HTML parsing failed', parseError.message);
            resolve([]);
          }
        });
      });
      
      req.on('error', (error) => {
        logger.debug('YouTube request failed', error.message);
        resolve([]);
      });
      
      req.on('timeout', () => {
        req.destroy();
        resolve([]);
      });
      
      req.setTimeout(8000);
      req.end();
    });
  } catch (error) {
    logger.debug('YouTube search setup failed', error.message);
    return [];
  }
}

async function searchYouTubeWithYtDlp(query, limit = 5) {
  const config = getConfig();
  const ytDlpPath = config.ytDlpPath;
  
  try {
    return new Promise((resolve) => {
      const args = [
        `ytsearch${limit}:${query}`,
        '--default-search', 'ytsearch',
        '--flat-playlist',
        '--print', '%(title)s|||%(id)s|||%(duration)s|||%(url)s',
        '--no-warnings',
        '--quiet'
      ];
      
      const process = spawn(ytDlpPath, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      process.on('close', (code) => {
        if (code !== 0) {
          logger.debug('yt-dlp search failed', stderr);
          resolve([]);
          return;
        }
        
        const results = [];
        const lines = stdout.trim().split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          if (results.length >= limit) break;
          
          const parts = line.split('|||');
          if (parts.length >= 2) {
            const title = parts[0] || 'Unknown';
            const videoId = parts[1] || '';
            const duration = parts[2] || '';
            const url = parts[3] || `https://www.youtube.com/watch?v=${videoId}`;
            
            results.push({
              title: title,
              url: url,
              snippet: duration ? `Duration: ${duration}` : '',
              videoId: videoId,
              duration: duration
            });
          }
        }
        
        resolve(results);
      });
      
      process.on('error', (err) => {
        if (err.code === 'ENOENT') {
          logger.debug('yt-dlp not found, using direct YouTube search');
        } else {
          logger.debug('yt-dlp spawn error', err.message);
        }
        resolve([]);
      });
      
      // Timeout after 10 seconds
      setTimeout(() => {
        if (!process.killed) {
          process.kill('SIGTERM');
          resolve([]);
        }
      }, 10000);
    });
  } catch (error) {
    logger.debug('yt-dlp search setup failed', error.message);
    return [];
  }
}

async function searchYouTube(query, limit = 5) {
  // Try yt-dlp first if available (most reliable)
  const ytDlpResults = await searchYouTubeWithYtDlp(query, limit);
  if (ytDlpResults.length > 0) {
    logger.info('YouTube search via yt-dlp successful', { count: ytDlpResults.length });
    return ytDlpResults;
  }
  
  // Fallback to direct HTML parsing
  logger.debug('Using direct YouTube HTML search');
  const directResults = await searchYouTubeDirect(query, limit);
  
  if (directResults.length > 0) {
    logger.info('YouTube search via direct method successful', { count: directResults.length });
    return directResults;
  }
  
  logger.warn('All YouTube search methods failed, providing search link');
  return [{
    title: `${query} - Search on YouTube`,
    url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    snippet: 'Click to search on YouTube',
    videoId: null
  }];
}

async function searchSong(rawQuery) {
  const query = (rawQuery || '').trim();
  if (!query) {
    return {
      query,
      matches: [],
      best: null
    };
  }

  const viaN8n = await searchViaN8n(query);
  if (viaN8n) {
    return { query, matches: viaN8n.matches, best: viaN8n.best };
  }

  // Build search query with "song" suffix for better results
  const searchQuery = `${query} song`;

  try {
    logger.info('Searching YouTube for track', searchQuery);
    
    const config = getConfig();
    const searchPromise = searchYouTube(searchQuery, 5);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Search timeout')), config.searchTimeout || 45000)
    );
    
    const matches = await Promise.race([searchPromise, timeoutPromise]);

    if (matches.length === 0) {
      logger.warn('No YouTube results found', searchQuery);
      const fallbackMatch = {
        title: `${query} - Search on YouTube`,
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
        snippet: 'No direct match found. Click to search on YouTube.',
        videoId: null
      };
      return { 
        query, 
        matches: [fallbackMatch], 
        best: fallbackMatch 
      };
    }

    const best = matches[0];
    logger.info('Best match found', { title: best.title, url: best.url });
    
    return {
      query,
      matches,
      best
    };
  } catch (error) {
    logger.error('YouTube search failed', error);
    const fallbackMatch = {
      title: `${query} - Search on YouTube`,
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      snippet: 'Search failed. Click to search on YouTube.',
      videoId: null
    };
    return {
      query,
      matches: [fallbackMatch],
      best: fallbackMatch
    };
  }
}

module.exports = {
  searchSong
};
