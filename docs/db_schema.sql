SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `chatbot-db`
--

-- --------------------------------------------------------

--
-- Table structure for table `admins`
--

CREATE TABLE `admins` (
  `user_guid` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_by` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `banned_words_presets`
--

CREATE TABLE `banned_words_presets` (
  `preset_id` int NOT NULL,
  `preset_name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `preset_description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `language` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'english',
  `words` json NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `creation_timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `latest_update_timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `bots`
--

CREATE TABLE `bots` (
  `bot_id` int NOT NULL,
  `bot_status` varchar(25) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bot_guid` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bot_name` varchar(75) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bot_token` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bot_refresh_token` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bot_latest_token_update` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `bot_use_count` int NOT NULL,
  `creation_timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `latest_update_timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `bot_entity_relations`
--

CREATE TABLE `bot_entity_relations` (
  `relationship_id` int NOT NULL,
  `entity_guid` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bot_id` int NOT NULL,
  `creation_timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `latest_update_timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `entities`
--

CREATE TABLE `entities` (
  `entity_guid` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_status` varchar(25) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `entity_type` varchar(15) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_parent_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `entity_name` varchar(75) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_commands` json NOT NULL,
  `entity_timers` json NOT NULL,
  `timer_counter_max` int DEFAULT NULL,
  `read_only` tinyint(1) NOT NULL DEFAULT '0',
  `entity_permissions` json NOT NULL,
  `latest_sync_timestamp` datetime DEFAULT CURRENT_TIMESTAMP,
  `creation_timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `latest_update_timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `profanity_filter_config`
--

CREATE TABLE `profanity_filter_config` (
  `entity_guid` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `banned_words_preset_id` int DEFAULT NULL,
  `custom_words` json DEFAULT NULL,
  `discord_webhook_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `discord_custom_message` text COLLATE utf8mb4_unicode_ci,
  `message_reply` text COLLATE utf8mb4_unicode_ci,
  `mute_duration_seconds` int DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `creation_timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `latest_update_timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `site_options`
--

CREATE TABLE `site_options` (
  `option_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `option_value` text COLLATE utf8mb4_unicode_ci,
  `option_description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_public` tinyint(1) NOT NULL DEFAULT '0',
  `creation_timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `latest_update_timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `user_entity_relations`
--

CREATE TABLE `user_entity_relations` (
  `relationship_id` int NOT NULL,
  `entity_guid` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_guid` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `creation_timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `latest_update_timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `welcome_messages`
--

CREATE TABLE `welcome_messages` (
  `entity_guid` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `creation_timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `latest_update_timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `admins`
--
ALTER TABLE `admins`
  ADD PRIMARY KEY (`user_guid`),
  ADD KEY `idx_created_at` (`created_at`);

--
-- Indexes for table `banned_words_presets`
--
ALTER TABLE `banned_words_presets`
  ADD PRIMARY KEY (`preset_id`),
  ADD UNIQUE KEY `unique_preset_name` (`preset_name`),
  ADD KEY `idx_is_active` (`is_active`),
  ADD KEY `idx_language` (`language`),
  ADD KEY `idx_preset_id_active` (`preset_id`,`is_active`);

--
-- Indexes for table `bots`
--
ALTER TABLE `bots`
  ADD PRIMARY KEY (`bot_id`),
  ADD KEY `idx_bot_status` (`bot_status`),
  ADD KEY `idx_bot_guid` (`bot_guid`),
  ADD KEY `idx_bot_id_status` (`bot_id`,`bot_status`),
  ADD KEY `idx_latest_update_timestamp` (`latest_update_timestamp`);

--
-- Indexes for table `bot_entity_relations`
--
ALTER TABLE `bot_entity_relations`
  ADD PRIMARY KEY (`relationship_id`),
  ADD UNIQUE KEY `uk_ber_entity_guid_only` (`entity_guid`),
  ADD KEY `idx_bot_id` (`bot_id`);

--
-- Indexes for table `entities`
--
ALTER TABLE `entities`
  ADD UNIQUE KEY `entity_guid` (`entity_guid`),
  ADD KEY `idx_entity_name` (`entity_name`),
  ADD KEY `idx_entity_status` (`entity_status`),
  ADD KEY `idx_entity_parent_id` (`entity_parent_id`),
  ADD KEY `idx_latest_update_timestamp` (`latest_update_timestamp`),
  ADD KEY `idx_latest_sync_timestamp` (`latest_sync_timestamp`),
  ADD KEY `idx_sync_query` (`entity_status`,`latest_sync_timestamp`),
  ADD KEY `idx_entity_guid_status` (`entity_guid`,`entity_status`);

--
-- Indexes for table `profanity_filter_config`
--
ALTER TABLE `profanity_filter_config`
  ADD PRIMARY KEY (`entity_guid`),
  ADD KEY `fk_pfc_preset_id` (`banned_words_preset_id`),
  ADD KEY `idx_is_active` (`is_active`),
  ADD KEY `idx_entity_guid_active` (`entity_guid`,`is_active`);

--
-- Indexes for table `site_options`
--
ALTER TABLE `site_options`
  ADD PRIMARY KEY (`option_key`);

--
-- Indexes for table `user_entity_relations`
--
ALTER TABLE `user_entity_relations`
  ADD PRIMARY KEY (`relationship_id`),
  ADD UNIQUE KEY `uk_user_entity_unique` (`user_guid`,`entity_guid`),
  ADD KEY `idx_entity_guid` (`entity_guid`);

--
-- Indexes for table `welcome_messages`
--
ALTER TABLE `welcome_messages`
  ADD PRIMARY KEY (`entity_guid`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `banned_words_presets`
--
ALTER TABLE `banned_words_presets`
  MODIFY `preset_id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `bots`
--
ALTER TABLE `bots`
  MODIFY `bot_id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `bot_entity_relations`
--
ALTER TABLE `bot_entity_relations`
  MODIFY `relationship_id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `user_entity_relations`
--
ALTER TABLE `user_entity_relations`
  MODIFY `relationship_id` int NOT NULL AUTO_INCREMENT;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `bot_entity_relations`
--
ALTER TABLE `bot_entity_relations`
  ADD CONSTRAINT `fk_ber_bot_id` FOREIGN KEY (`bot_id`) REFERENCES `bots` (`bot_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_ber_entity_guid` FOREIGN KEY (`entity_guid`) REFERENCES `entities` (`entity_guid`) ON DELETE CASCADE;

--
-- Constraints for table `profanity_filter_config`
--
ALTER TABLE `profanity_filter_config`
  ADD CONSTRAINT `fk_pfc_entity_guid` FOREIGN KEY (`entity_guid`) REFERENCES `entities` (`entity_guid`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_pfc_preset_id` FOREIGN KEY (`banned_words_preset_id`) REFERENCES `banned_words_presets` (`preset_id`) ON DELETE SET NULL;

--
-- Constraints for table `user_entity_relations`
--
ALTER TABLE `user_entity_relations`
  ADD CONSTRAINT `fk_uer_entity_guid` FOREIGN KEY (`entity_guid`) REFERENCES `entities` (`entity_guid`) ON DELETE CASCADE;

--
-- Constraints for table `welcome_messages`
--
ALTER TABLE `welcome_messages`
  ADD CONSTRAINT `fk_wm_entity_guid` FOREIGN KEY (`entity_guid`) REFERENCES `entities` (`entity_guid`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
