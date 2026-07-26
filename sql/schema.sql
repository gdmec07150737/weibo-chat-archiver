CREATE DATABASE IF NOT EXISTS weibo_group_chat
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE weibo_group_chat;

-- 单条消息表（权威存储）
CREATE TABLE IF NOT EXISTS chat_messages (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_id      VARCHAR(64)     NOT NULL,
  message_id    VARCHAR(64)     NOT NULL,
  archive_date  DATE            NOT NULL,
  msg_time      DATETIME(3)     NULL,
  msg_time_unix INT UNSIGNED    NULL,
  sender_id     VARCHAR(64)     NULL,
  sender_name   VARCHAR(255)    NULL,
  content       TEXT            NULL,
  raw_json      JSON            NOT NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_group_message (group_id, message_id),
  KEY idx_group_date (group_id, archive_date),
  KEY idx_msg_time (group_id, msg_time_unix)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 旧版按日 JSON 表已废弃；服务启动时会自动迁移到 chat_messages 后删除
-- DROP TABLE IF EXISTS chat_archives;
