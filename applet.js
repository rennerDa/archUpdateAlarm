const Applet = imports.ui.applet;

const Lang = imports.lang
// http://developer.gnome.org/glib/unstable/glib-The-Main-Event-Loop.html
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;

const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;

// http://developer.gnome.org/st/stable/
const St = imports.gi.St

// http://developer.gnome.org/libsoup/stable/libsoup-client-howto.html
const Soup = imports.gi.Soup

const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;

const UUID = "archUpdateAlarm"

// Settings keys
//----------------------------------

const ALARM_REFRESH_INTERVAL = 'refreshInterval'

const KEYS = [
  ALARM_REFRESH_INTERVAL
]

// Soup session (see https://bugzilla.gnome.org/show_bug.cgi?id=661323#c64)
const _httpSession = new Soup.Session()
Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ProxyResolverDefault())

// TODO da_re: move into own file
// This is partly copied from https://github.com/optimisme/gjs-examples/blob/master/assets/spawn.js
const SpawnReader = function () { };
SpawnReader.prototype.spawn = function (path, command, func, finishFunc) {

    let pid, stdin, stdout, stderr, stream, reader;

    [res, pid, stdin, stdout, stderr] = GLib.spawn_async_with_pipes(
        path, command, null, GLib.SpawnFlags.SEARCH_PATH, null);

    stream = new Gio.DataInputStream({ base_stream : new Gio.UnixInputStream({ fd : stdout }) });

    this.read(stream, func, finishFunc);
};

SpawnReader.prototype.read = function (stream, func, finishFunc) {

    stream.read_line_async(GLib.PRIORITY_LOW, null, Lang.bind (this, function (source, res) {

        let out, length;

        [out, length] = source.read_line_finish(res);
        if (out !== null) {
            func(out);
            this.read(source, func, finishFunc);
        } else {
          finishFunc();
        }
    }));
};

function MyApplet(metadata, orientation, panel_height, instance_id) {
    this.settings = new Settings.AppletSettings(this, UUID, instance_id);
    this._init(metadata, orientation, panel_height, instance_id);
}

MyApplet.prototype = {
    __proto__: Applet.TextIconApplet.prototype,

    _init: function(metadata, orientation, panel_height, instance_id) {
        Applet.TextIconApplet.prototype._init.call(this, orientation, panel_height, instance_id);

        Gtk.IconTheme.get_default().append_search_path(metadata.path);

        // Interface: TextIconApplet
        this.set_applet_icon_name('arch_updated');
        this.set_applet_label('...');
        this.set_applet_tooltip(_('Initialize update check'));

        this.assignMessageSource();

        // bind settings
        //----------------------------------

        for (let k in KEYS) {
            let key = KEYS[k]
            let keyProp = "_" + key
            this.settings.bindProperty(Settings.BindingDirection.IN, key, keyProp,
                                       null, null)
        }

        // PopupMenu
        //----------------------------------

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);;

        this.menu.addMenuItem(new PopupMenu.PopupMenuItem(_('Update ...')));
      }

    , assignMessageSource: function() {
        if (!this.messageSource) {
            this.messageSource = new MessageTray.SystemNotificationSource();
            if (Main.messageTray) Main.messageTray.add(this.messageSource);
        }
    }

    , pinFailNotification: function(jobName) {
        let icon = new St.Icon({ icon_name: 'dialog-error',
                             icon_type: St.IconType.FULLCOLOR,
                             icon_size: 36 });
        let notification = new MessageTray.Notification(this.messageSource, 'Jenkins-Job failed', 'The job ' + jobName + ', which has been successful last check, failed.', { icon: icon });
        notification.setTransient(false);
        notification.setResident(true);
        notification.setUrgency(MessageTray.Urgency.CRITICAL);
        this.messageSource.notify(notification);
    }

    , on_applet_clicked: function() {
        this.menu.toggle();
    }

    , on_applet_added_to_panel: function() {
        this.running = true;
        Mainloop.timeout_add_seconds(3, Lang.bind(this, function mainloopTimeout() {
          this.checkForUpdates()
        }));
    }

    , on_applet_removed_from_panel: function() {
        this.running = false;
    }

    , updateAppletMenu: function() {
      let applet = this;

      for (let updateIndex in applet.updates) {
        let update = applet.updates[updateIndex];
        let item = new PopupMenu.PopupMenuItem(update.toString());
        item.actor.set_style('font-size:10px; padding-left:3em;');
        this.checkupdatesMenu.menu.addMenuItem(item);
      }
      this.checkupdatesMenu.menu.open();

      this.setToolbar(applet.updates.length)

      log("Checking of updates complete");
    }

    , setToolbar: function(availableUpdateCount) {
      let icon = availableUpdateCount > 0 ? 'arch_update' : 'arch_updated';
      this.set_applet_icon_name(icon);
      this.set_applet_label(availableUpdateCount + ' Updates');
      this.set_applet_tooltip(availableUpdateCount + ' Updates available');
    }

    , checkForUpdates: function() {
        if (!this.running) {
            return;
        }

        log("Checking updates");
        let applet = this;
        let updatesAvailable = false;

        applet.refreshMenu();
        applet.updates = [];
        let reader = new SpawnReader();
        reader.spawn('./', ['checkupdates'], (update) => {
          if(update != "") {
            applet.updates.push(update);
          }
        }, () => {
          log("Finished update check");
          applet.updateAppletMenu();
        });

        Mainloop.timeout_add_seconds(this._refreshInterval, Lang.bind(this, function() {
            this.checkForUpdates()
        }));
    }

    , refreshMenu: function() {
        let applet = this;
        this.menu.removeAll();
        this.checkupdatesMenu = new PopupMenu.PopupSubMenuMenuItem('Available updates');

        this.set_applet_icon_name('arch_updated');
        this.set_applet_label('...');
        this.set_applet_tooltip('Initialize update check');

        let manuallyRefreshButton = new PopupMenu.PopupMenuItem('Refresh');
        manuallyRefreshButton.connect('activate', Lang.bind(this, function (menuItem, event) {
            log('Manually refresh');
            applet.checkForUpdates();
        }));
        this.menu.addMenuItem(manuallyRefreshButton);
        this.menu.addMenuItem(this.checkupdatesMenu);
    }
};

// Logging
//----------------------------------------------------------------------

function log(message) {
  global.log(UUID + "#" + log.caller.name + ": " + message)
}

function logError(error) {
  global.logError(UUID + "#" + logError.caller.name + ": " + error)
}


// Entry point
//----------------------------------------------------------------------

function main(metadata, orientation, panel_height, instance_id) {
    return new MyApplet(metadata, orientation, panel_height, instance_id);
}
