/*
 * Copyright 2025 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import camelCase from 'lodash/camelCase';
import upperFirst from 'lodash/upperFirst';
import { isMonoRepo } from '@backstage/cli-node';
import { assertError } from '@backstage/errors';

import { paths } from '../../paths';
import { Task } from '../../tasks';
import { addCodeownersEntry } from '../../codeowners';

import { createDirName, resolvePackageName } from './utils';
import { runAdditionalActions } from './additionalActions';
import { executePluginPackageTemplate } from './executePluginPackageTemplate';
import { TemporaryDirectoryManager } from './TemporaryDirectoryManager';
import { NewConfig } from '../types';
import { NewTemplate } from '../types';
import { Options } from './utils';

type ExecuteNewTemplateOptions = {
  config: NewConfig;
  template: NewTemplate;
  params: Options;
};

export async function executeNewTemplate(options: ExecuteNewTemplateOptions) {
  const { template, params } = options;

  const tmpDirManager = TemporaryDirectoryManager.create();

  const dirName = createDirName(template, params);
  const targetDir = paths.resolveTargetRoot(params.targetPath, dirName);

  const packageName = resolvePackageName({
    baseName: dirName,
    scope: params.scope,
    plugin: template.plugin ?? true,
  });

  const moduleVar =
    params.moduleId ??
    `${camelCase(params.id)}Module${camelCase(
      params.moduleId,
    )[0].toUpperCase()}${camelCase(params.moduleId).slice(1)}`; // used in default-backend-module template
  const extensionName = `${upperFirst(camelCase(params.id))}Page`; // used in default-plugin template
  const pluginVar = `${camelCase(params.id)}Plugin`; // used in default-backend-plugin and default-plugin template

  let modified = false;
  try {
    await executePluginPackageTemplate(
      {
        isMonoRepo: await isMonoRepo(),
        createTemporaryDirectory: tmpDirManager.createDir,
        markAsModified() {
          modified = true;
        },
      },
      {
        targetDir,
        templateDir: template.templatePath,
        values: {
          name: packageName,
          privatePackage: params.private,
          pluginVersion: params.baseVersion,
          moduleVar,
          extensionName,
          pluginVar,
          ...params,
        },
      },
    );

    if (template.additionalActions?.length) {
      await runAdditionalActions(template.additionalActions, {
        name: packageName,
        version: params.baseVersion,
        id: params.id, // for frontend legacy
        extensionName, // for frontend legacy
      });
    }

    if (params.owner) {
      await addCodeownersEntry(targetDir, params.owner);
    }

    await Task.forCommand('yarn install', {
      cwd: targetDir,
      optional: true,
    });
    await Task.forCommand('yarn lint --fix', {
      cwd: targetDir,
      optional: true,
    });

    Task.log();
    Task.log(`🎉  Successfully created ${template.id}`);
    Task.log();
  } catch (error) {
    assertError(error);
    Task.error(error.message);

    if (modified) {
      Task.log('It seems that something went wrong in the creation process 🤔');
      Task.log();
      Task.log(
        'We have left the changes that were made intact in case you want to',
      );
      Task.log(
        'continue manually, but you can also revert the changes and try again.',
      );

      Task.error(`🔥  Failed to create ${template.id}!`);
    }
  } finally {
    tmpDirManager.cleanup();
  }
}
