plugins {
    id("com.android.application") version "8.3.1"
}

android {
    namespace = "com.skidhomework.server"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.skidhomework.server"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    // Rename the output APK to .jar so it's ready to be pushed via ADB
    applicationVariants.all {
        val variant = this
        variant.outputs.all {
            val output = this as com.android.build.gradle.internal.api.ApkVariantOutputImpl
            output.outputFileName = "camera-server.jar"
        }
    }
}

dependencies {
    // No external dependencies needed for the pure Android APIs we use
}
