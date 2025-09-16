const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const database = require('../db');
const logger = require('../utils/logger');

class MediaManager {
  constructor(bot) {
    this.bot = bot;
    this.db = database;
    // Detecta se está rodando em Docker ou local
    const isDocker = process.env.NODE_ENV === 'production' || fsSync.existsSync('/.dockerenv');
    this.mediaDir = isDocker ? '/app/media' : path.join(__dirname, '../media');
    this.ensureMediaDir();
  }

  // Garante que o diretório de mídia existe
  async ensureMediaDir() {
    try {
      await fs.mkdir(this.mediaDir, { recursive: true });
      console.log('📁 Diretório de mídia verificado');
    } catch (error) {
      console.error('❌ Erro ao criar diretório de mídia:', error.message);
    }
  }

  // Processar e salvar mídia recebida
  async processMedia(message, category = 'general', tags = null) {
    try {
      let mediaInfo = null;
      let fileId = null;
      let fileType = null;

      // Identificar tipo de mídia
      if (message.photo) {
        const photo = message.photo[message.photo.length - 1]; // Maior resolução
        fileId = photo.file_id;
        fileType = 'photo';
        mediaInfo = {
          width: photo.width,
          height: photo.height,
          file_size: photo.file_size
        };
      } else if (message.video) {
        fileId = message.video.file_id;
        fileType = 'video';
        mediaInfo = {
          width: message.video.width,
          height: message.video.height,
          duration: message.video.duration,
          file_size: message.video.file_size,
          mime_type: message.video.mime_type,
          file_name: message.video.file_name
        };
      } else if (message.document) {
        fileId = message.document.file_id;
        fileType = 'document';
        mediaInfo = {
          file_size: message.document.file_size,
          mime_type: message.document.mime_type,
          file_name: message.document.file_name
        };
      } else if (message.audio) {
        fileId = message.audio.file_id;
        fileType = 'audio';
        mediaInfo = {
          duration: message.audio.duration,
          file_size: message.audio.file_size,
          mime_type: message.audio.mime_type,
          file_name: message.audio.file_name
        };
      } else if (message.voice) {
        fileId = message.voice.file_id;
        fileType = 'voice';
        mediaInfo = {
          duration: message.voice.duration,
          file_size: message.voice.file_size,
          mime_type: message.voice.mime_type
        };
      } else if (message.sticker) {
        fileId = message.sticker.file_id;
        fileType = 'sticker';
        mediaInfo = {
          width: message.sticker.width,
          height: message.sticker.height,
          file_size: message.sticker.file_size
        };
      } else if (message.animation) {
        fileId = message.animation.file_id;
        fileType = 'animation';
        mediaInfo = {
          width: message.animation.width,
          height: message.animation.height,
          duration: message.animation.duration,
          file_size: message.animation.file_size,
          mime_type: message.animation.mime_type,
          file_name: message.animation.file_name
        };
      }

      if (!fileId || !fileType) {
        throw new Error('Tipo de mídia não suportado');
      }

      // Verificar se já existe no banco
      const existingMedia = await this.db.getMediaByFileId(fileId);
      if (existingMedia) {
        console.log('📎 Mídia já existe no banco:', fileId);
        return existingMedia;
      }

      // Baixar arquivo (opcional - para backup local)
      let filePath = null;
      try {
        const fileInfo = await this.bot.getFile(fileId);
        const fileName = `${Date.now()}_${fileId.substring(0, 10)}.${this.getFileExtension(fileType, mediaInfo.mime_type)}`;
        filePath = path.join(this.mediaDir, fileName);
        
        const fileUrl = `https://api.telegram.org/file/bot${this.bot.token}/${fileInfo.file_path}`;
        // Aqui você pode implementar o download se necessário
        // await this.downloadFile(fileUrl, filePath);
      } catch (error) {
        console.log('⚠️ Não foi possível baixar arquivo:', error.message);
      }

      // Salvar no banco
      const mediaData = {
        file_id: fileId,
        file_type: fileType,
        file_name: mediaInfo.file_name || null,
        file_size: mediaInfo.file_size || null,
        file_path: filePath,
        mime_type: mediaInfo.mime_type || null,
        width: mediaInfo.width || null,
        height: mediaInfo.height || null,
        duration: mediaInfo.duration || null,
        caption: message.caption || null,
        tags: tags,
        category: category,
        uploaded_by: message.from ? message.from.id : null
      };

      const mediaId = await this.db.saveMedia(mediaData);
      
      logger.info('Mídia salva com sucesso', {
        mediaId,
        fileType,
        fileId: fileId.substring(0, 10),
        category
      });

      return { id: mediaId, ...mediaData };

    } catch (error) {
      logger.error('Erro ao processar mídia', error);
      throw error;
    }
  }

  // Salvar mídia diretamente do Telegram usando file_id
  async saveMediaFromTelegram(fileId, fileType, options = {}) {
    try {
      // Obter informações do arquivo do Telegram
      const file = await this.bot.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;
      
      // Baixar o arquivo
      const fetch = require('node-fetch');
      const response = await fetch(fileUrl);
      
      if (!response.ok) {
        throw new Error(`Erro ao baixar arquivo: ${response.statusText}`);
      }
      
      const buffer = await response.buffer();
      
      // Gerar nome único para o arquivo
      const timestamp = Date.now();
      const extension = this.getFileExtension(fileType, file.file_path);
      const filename = `${fileType}_${timestamp}${extension}`;
      const filePath = path.join(this.mediaDir, filename);
      
      // Salvar arquivo no disco
      await fs.writeFile(filePath, buffer);
      
      // Salvar informações no banco de dados
      const mediaData = {
        file_id: fileId,
        file_type: fileType,
        file_path: filePath,
        filename: filename,
        file_size: buffer.length,
        mime_type: this.getMimeType(extension),
        caption: options.caption || null,
        category: options.category || 'admin_upload',
        tags: options.tags || null,
        uploaded_by: options.uploaded_by || null,
        auto_upload: options.auto_upload || false,
        created_at: new Date().toISOString(),
        usage_count: 0,
        last_used: null
      };
      
      const result = await this.db.run(
        `INSERT INTO media (
          file_id, file_type, file_path, filename, file_size, mime_type,
          caption, category, tags, uploaded_by, auto_upload, created_at,
          usage_count, last_used
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mediaData.file_id, mediaData.file_type, mediaData.file_path,
          mediaData.filename, mediaData.file_size, mediaData.mime_type,
          mediaData.caption, mediaData.category, mediaData.tags,
          mediaData.uploaded_by, mediaData.auto_upload, mediaData.created_at,
          mediaData.usage_count, mediaData.last_used
        ]
      );
      
      logger.info(`Mídia salva automaticamente: ${filename}`);
      
      return {
        id: result.lastID,
        ...mediaData
      };
      
    } catch (error) {
      logger.error('Erro ao salvar mídia do Telegram:', error);
      throw error;
    }
  }
  
  // Obter MIME type baseado na extensão
  getMimeType(extension) {
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.avi': 'video/avi',
      '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg'
    };
    
    return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
  }

  // Obter extensão do arquivo baseada no tipo
  getFileExtension(fileType, mimeType) {
    const extensions = {
      photo: 'jpg',
      video: 'mp4',
      audio: 'mp3',
      voice: 'ogg',
      sticker: 'webp',
      animation: 'gif',
      document: 'bin'
    };

    if (mimeType) {
      const mimeExtensions = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'video/mp4': 'mp4',
        'video/avi': 'avi',
        'audio/mpeg': 'mp3',
        'audio/ogg': 'ogg',
        'application/pdf': 'pdf',
        'text/plain': 'txt'
      };
      return mimeExtensions[mimeType] || extensions[fileType] || 'bin';
    }

    return extensions[fileType] || 'bin';
  }

  // Buscar mídia aleatória para auto-post
  async getRandomMediaForPost(category = null, excludeIds = []) {
    try {
      const media = await this.db.getRandomMedia(category, excludeIds);
      if (media) {
        await this.db.updateMediaUsage(media.id);
      }
      return media;
    } catch (error) {
      logger.error('Erro ao buscar mídia aleatória', error);
      return null;
    }
  }

  // Listar mídias por categoria
  async getMediaByCategory(category, limit = 50, offset = 0) {
    try {
      return await this.db.getAllMedia(category, limit, offset);
    } catch (error) {
      logger.error('Erro ao buscar mídia por categoria', error);
      return [];
    }
  }

  // Criar postagem programada
  async schedulePost(mediaId, groupId, scheduledTime, caption = null, createdBy = null) {
    try {
      const postData = {
        media_id: mediaId,
        group_id: groupId,
        caption: caption,
        scheduled_time: scheduledTime,
        created_by: createdBy
      };

      const postId = await this.db.createScheduledPost(postData);
      
      logger.info('Postagem programada criada', {
        postId,
        mediaId,
        groupId,
        scheduledTime
      });

      return postId;
    } catch (error) {
      logger.error('Erro ao programar postagem', error);
      throw error;
    }
  }

  // Processar postagens pendentes
  async processPendingPosts() {
    try {
      const pendingPosts = await this.db.getPendingPosts();
      
      for (const post of pendingPosts) {
        try {
          await this.sendScheduledPost(post);
        } catch (error) {
          logger.error('Erro ao enviar postagem programada', error, {
            postId: post.id
          });
          
          await this.db.updateScheduledPostStatus(
            post.id, 
            'failed', 
            error.message
          );
        }
      }

      return pendingPosts.length;
    } catch (error) {
      logger.error('Erro ao processar postagens pendentes', error);
      return 0;
    }
  }

  // Enviar postagem programada
  async sendScheduledPost(post) {
    try {
      const caption = post.caption || post.media_caption || '';
      const options = {
        caption: caption,
        parse_mode: 'HTML'
      };

      let sentMessage = null;

      switch (post.file_type) {
        case 'photo':
          sentMessage = await this.bot.sendPhoto(post.group_telegram_id, post.file_id, options);
          break;
        case 'video':
          sentMessage = await this.bot.sendVideo(post.group_telegram_id, post.file_id, options);
          break;
        case 'document':
          sentMessage = await this.bot.sendDocument(post.group_telegram_id, post.file_id, options);
          break;
        case 'audio':
          sentMessage = await this.bot.sendAudio(post.group_telegram_id, post.file_id, options);
          break;
        case 'voice':
          sentMessage = await this.bot.sendVoice(post.group_telegram_id, post.file_id, options);
          break;
        case 'sticker':
          sentMessage = await this.bot.sendSticker(post.group_telegram_id, post.file_id);
          break;
        case 'animation':
          sentMessage = await this.bot.sendAnimation(post.group_telegram_id, post.file_id, options);
          break;
        default:
          throw new Error(`Tipo de mídia não suportado: ${post.file_type}`);
      }

      await this.db.updateScheduledPostStatus(post.id, 'sent');
      
      logger.info('Postagem programada enviada', {
        postId: post.id,
        groupId: post.group_telegram_id,
        messageId: sentMessage.message_id
      });

      return sentMessage;
    } catch (error) {
      logger.error('Erro ao enviar postagem programada', error);
      throw error;
    }
  }

  // Estatísticas de mídia
  async getMediaStats() {
    try {
      const stats = await this.db.all(`
        SELECT 
          file_type,
          category,
          COUNT(*) as count,
          SUM(usage_count) as total_usage,
          AVG(file_size) as avg_size
        FROM media 
        WHERE is_active = 1
        GROUP BY file_type, category
        ORDER BY count DESC
      `);

      const totalMedia = await this.db.get('SELECT COUNT(*) as total FROM media WHERE is_active = 1');
      const totalUsage = await this.db.get('SELECT SUM(usage_count) as total FROM media WHERE is_active = 1');

      return {
        total_media: totalMedia.total,
        total_usage: totalUsage.total,
        by_type_and_category: stats
      };
    } catch (error) {
      logger.error('Erro ao obter estatísticas de mídia', error);
      return null;
    }
  }

  // Limpar mídias antigas não utilizadas
  async cleanupOldMedia(daysOld = 30, minUsage = 0) {
    try {
      const sql = `
        UPDATE media 
        SET is_active = 0, updated_at = CURRENT_TIMESTAMP
        WHERE is_active = 1 
        AND usage_count <= ?
        AND created_at < datetime('now', '-' || ? || ' days')
      `;

      const result = await this.db.run(sql, [minUsage, daysOld]);
      
      logger.info('Limpeza de mídia concluída', {
        removedCount: result.changes,
        criteria: { daysOld, minUsage }
      });

      return result.changes;
    } catch (error) {
      logger.error('Erro na limpeza de mídia', error);
      return 0;
    }
  }
}

module.exports = MediaManager;